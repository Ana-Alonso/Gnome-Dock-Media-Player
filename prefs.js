import Adw  from 'gi://Adw';
import Gtk  from 'gi://Gtk';
import Gio  from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class DockMediaPlayerPreferences extends ExtensionPreferences
{
    fillPreferencesWindow(window)
    {
        const settings = this.getSettings();
        
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);
        
        //Style Group
        
        const styleGroup = new Adw.PreferencesGroup({
            title: 'Widget Style',
            description: 'Control how the widget looks inside the dock',
        });
        appearancePage.add(styleGroup);
        
        styleGroup.add(this.makeSpinButtonRow(
            'Widget Width',
            'Width of the expanded media widget in pixels',
            settings,
            'widget-width',
            { lower: 160, upper: 500, step: 10 },
        ));
        
        styleGroup.add(this.makeSpinButtonRow(
            'Background Opacity',
            'Background opacity of the widget (0.0 - 1.0)',
            settings,
            'background-opacity',
            { lower: 0.0, upper: 1.0, step: 0.05, digits: 2 },
        ));

        //Visibility group
        
        const visibilityGroup = new Adw.PreferencesGroup({
            title: 'Visible Elements',
            description: 'Choose which parts of the widget are shown',
        });
        appearancePage.add(visibilityGroup);
        
        const showArtistRow = new Adw.SwitchRow({
            title: 'Show Artist Name',
            subtitle: 'Display artist name below the track title',
        });
        settings.bind('show-artist', showArtistRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(showArtistRow);
        
        const showControlsRow = new Adw.SwitchRow({
            title: 'Show Playback Controls',
            subtitle: 'Display media control buttons',
        });
        settings.bind('show-controls', showControlsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(showControlsRow);
        
        //Behavior page
        
        const behaviorPage = new Adw.PreferencesPage({
            title: 'Behavior',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(behaviorPage);

        //Behavior group
        const dockIntegrationGroup = new Adw.PreferencesGroup({
            title: 'Dock Integration',
            description: 'Control how the widget integrates with Dash to Dock',
        });
        behaviorPage.add(dockIntegrationGroup);
        
        const positionModel = new Gtk.StringList();
        positionModel.append('Start (before app icons)');
        positionModel.append('End (after app icons)');

        const positionRow = new Adw.ComboRow({
            title: 'Widget Position',
            subtitle: 'Where to insert the widget in the dock',
            model: positionModel,
        });
        
        //Sync with currently selected value
        positionRow.set_selected(settings.get_string('widget-position') === 'start' ? 0 : 1);
        
        //will be disconnected when we close the window
        positionRow.connect('notify::selected', () => {
            const value = positionRow.selected === 0 ? 'start' : 'end';
            if (settings.get_string('widget-position') !== value)
            {
                settings.set_string('widget-position', value);
            }
        });

        dockIntegrationGroup.add(positionRow);

        //Animation group
        const animationGroup = new Adw.PreferencesGroup({
            title: 'Animations',
        });
        behaviorPage.add(animationGroup);

        // Animation duration
        animationGroup.add(this.makeSpinButtonRow(
            'Animation Duration',
            'Speed of expand and collapse animations in milliseconds - set to 0 to disable animations',
            settings,
            'animation-duration',
            { lower: 0, upper: 1000, step: 50 },
        ));
    }
    
    makeSpinButtonRow(title, subtitle, settings, settingKey, params)
    {
        const row = new Adw.ActionRow({ title, subtitle });

        const spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: params.lower,
                upper: params.upper,
                step_increment: params.step,
            }),
            digits: params.digits ?? 0,
            valign: Gtk.Align.CENTER,
            width_request: 120,
        });

        settings.bind(settingKey, spinButton, 'value', Gio.SettingsBindFlags.DEFAULT);

        row.add_suffix(spinButton);
        row.set_activatable_widget(spinButton);
        return row;
    }
}
