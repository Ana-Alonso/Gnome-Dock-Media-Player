import { MediaStatus } from "./MediaControllerHelpers.js";
import Gio from 'gi://Gio';

const mprisInterface = `
<node>
    <interface name="org.mpris.MediaPlayer2.Player">
        <method name="PlayPause"/>
        <method name="Next"/>
        <method name="Previous"/>
        <method name="Stop"/>
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
    </interface>
</node>`;

const dBusInterface = `
<node>
    <interface name="org.freedesktop.DBus">
        <method name="ListNames">
            <arg direction="out" type="as"/>
        </method>
        <signal name="NameOwnerChanged">
            <arg direction="out" type="s"/>
            <arg direction="out" type="s"/>
            <arg direction="out" type="s"/>
        </signal>
    </interface>
</node>`;


//proxy constructors
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(mprisInterface);
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(dBusInterface);

export const MediaController = class MediaController
{
    constructor(playbackChangeCallback)
    {
        this._players = new Map(); // busName -> proxy
        this._playerSignals = new Map(); // busName -> GObject signal id
        this._playerStack = []; // stack - push most recent active payer to the top
        this._dBusProxy = null;
        this._onStatusChange = playbackChangeCallback;
        this._dBusSignalIDs = [];
        this._sleepSignalId = null;
    }

    startWatching()
    {
        if (this._dBusProxy)
        {
            return;
        }

        this._dBusProxy = new DBusProxy(
            Gio.DBus.session,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus"
        );

        //Find players that are already running
        const [names] = this._dBusProxy.ListNamesSync();
        names.forEach(name => {
            if (this.shouldAcceptName(name))
            {
                this.setupPlayerProxy(name);
            }
        });
        
        this._dBusSignalIDs.push(
            this._dBusProxy.connectSignal("NameOwnerChanged", (proxy, sender, [name, oldOwner, newOwner]) => {
                if (this.shouldAcceptName(name))
                {
                    if (newOwner && !oldOwner)
                    {
                        this.setupPlayerProxy(name);
                    }
                    else if (!newOwner && oldOwner)
                    {
                        this.removePlayer(name);
                    }
                }
            })
        );

        //subscribe to the system PrepareForSleep signal
        //when the parameter is false the PC just woke up
        this._sleepSignalId = Gio.DBus.system.signal_subscribe(
            'org.freedesktop.login1',
            'org.freedesktop.login1.Manager',
            'PrepareForSleep',
            '/org/freedesktop/login1',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [goingToSleep] = params.deep_unpack();
                if (!goingToSleep)
                    this.restartWatching();
            }
        );
    }
    
    restartWatching()
    {
        for (const [busName, proxy] of this._players)
        {
            const sigId = this._playerSignals.get(busName);
            if (sigId != null)
                proxy.disconnect(sigId);
        }
        
        this._players.clear();
        this._playerSignals.clear();
        this._playerStack = [];

        const [names] = this._dBusProxy.ListNamesSync();
        names.forEach(name => {
            if (this.shouldAcceptName(name))
                this.setupPlayerProxy(name);
        });

        //If nothing is playing after the rescanning, collapse the widget
        if (this._playerStack.length === 0)
        {
            this._onStatusChange(null, MediaStatus.STOPPED, null);   
        }
    }

    shouldAcceptName(name)
    {
        return name.startsWith("org.mpris.MediaPlayer2");
    }

    setupPlayerProxy(busName)
    {
        if (this._players.has(busName))
        {
            return;   
        }

        const proxy = new PlayerProxy(
            Gio.DBus.session,
            busName,
            '/org/mpris/MediaPlayer2'
        );

        this._players.set(busName, proxy);
        
        const signalID = proxy.connect('g-properties-changed', (p) => {
            this.handleStatusChange(busName, p.PlaybackStatus ?? MediaStatus.STOPPED);
        });
        
        this._playerSignals.set(busName, signalID);

        this.handleStatusChange(busName, proxy.PlaybackStatus ?? MediaStatus.STOPPED, proxy);
    }

    handleStatusChange(busName, status, manualProxy = null)
    {
        const proxy = manualProxy || this.getProxy(busName);
        if (!proxy)
            return;
        
        if (status === MediaStatus.PLAYING)
        {
            const index = this._playerStack.indexOf(busName);
            if (index !== -1)
                this._playerStack.splice(index, 1);
            this._playerStack.unshift(busName);
        }
        else if (!this._playerStack.includes(busName))
        {
            this._playerStack.push(busName);
        }
        
        const activeBus = this.findMostRecentPlayer();

        if (busName !== activeBus)
        {
            return;   
        }

        const trackInfo = this.buildTrackInfo(proxy);
        this._onStatusChange(busName, status, trackInfo);
    }

    buildTrackInfo(proxy)
    {
        const trackInfo = {
            title: "Unknown Title",
            artist: "Unknown Artist",
            artUrl: null,
        };

        const metadataVariant = proxy.get_cached_property('Metadata');
        if (!metadataVariant)
        {
            return trackInfo;   
        }

        const unpacked = metadataVariant.recursiveUnpack();

        if (unpacked['xesam:title'])
        {
            trackInfo.title = String(unpacked['xesam:title']);
        }

        if (unpacked['xesam:artist'])
        {
            const artist = unpacked['xesam:artist'];
            trackInfo.artist = Array.isArray(artist) ? artist.join(', ') : String(artist);
        }

        if (unpacked['mpris:artUrl'])
        {
            trackInfo.artUrl = String(unpacked['mpris:artUrl']);
        }

        return trackInfo;
    }

    removePlayer(busName)
    {
        const proxy = this._players.get(busName);
        if (proxy)
        {
            const signalID = this._playerSignals.get(busName);
            if (signalID != null)
            {
                proxy.disconnect(signalID);
            }
        }
        
        this._players.delete(busName);
        this._playerSignals.delete(busName);

        const index = this._playerStack.indexOf(busName);
        if (index !== -1)
        {
            this._playerStack.splice(index, 1);
        }
        
        const nextBus = this.findMostRecentPlayer();

        if (nextBus)
        {
            const nextProxy = this.getProxy(nextBus);
            this.handleStatusChange(nextBus, nextProxy.PlaybackStatus ?? MediaStatus.STOPPED, nextProxy);
        }
        else
        {
            this._onStatusChange(null, MediaStatus.STOPPED, null);
        }
    }
    
    findMostRecentPlayer()
    {
        return this._playerStack.find(b => {
            const p = this.getProxy(b);
            return p && p.PlaybackStatus === MediaStatus.PLAYING;
        }) ?? this._playerStack[0];
    }

    getProxy(busName)
    {
        return this._players.get(busName);
    }

    toggleStatus()
    {
        const proxy = this.findMostRecentProxy();
        if (!proxy)
        {
            return;
        }
        
        proxy.PlayPauseRemote((result, error) => {
            if (error)
            {
                logError(error);
            }
        });
    }

    goNext()
    {
        const proxy = this.findMostRecentProxy();
        if (!proxy)
        {
            return;
        }

        proxy.NextRemote((result, error) => {
            if (error)
            {
                logError(error);
            }
        });
    }

    goPrevious()
    {
        const proxy = this.findMostRecentProxy();

        proxy.PreviousRemote((result, error) => {
            if (error)
            {
                logError(error);
            }
        });
    }
    
    findMostRecentProxy()
    {
        const activeBus = this.findMostRecentPlayer();
        if (!activeBus)
        {
            return null;
        }

        const proxy = this.getProxy(activeBus);
        if (!proxy)
        {
            return null;
        }
        
        return proxy;
    }

    destroy()
    {
        for (const id of this._dBusSignalIDs)
        {
            this._dBusProxy.disconnectSignal(id);
        }
        
        this._dBusSignalIDs.length = 0;
        
        if (this._sleepSignalId != null)
        {
            Gio.DBus.system.signal_unsubscribe(this._sleepSignalId);
            this._sleepSignalId = null;
        }
        
        for (const [busName, proxy] of this._players)
        {
            const sigId = this._playerSignals.get(busName);
            if (sigId != null)
            {
                proxy.disconnect(sigId);
            }
        }

        this._players.clear();
        this._playerSignals.clear();
        this._playerStack = [];
        this._onStatusChange = null;
        this._dBusProxy = null;
    }
}