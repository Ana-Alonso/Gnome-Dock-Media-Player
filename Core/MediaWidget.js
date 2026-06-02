import { CoverArtHelpers } from "./CoverArtHelpers.js";
import { DefaultColors, StyleClassNames } from "./StyleClassesHelper.js";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Pango from "gi://Pango";

const TITLE_FALLBACK = "Unknown Title";
const ARTIST_FALLBACK = "Unknown Artist";
const EXPANDED = "expanded";
const COLLAPSED = "collapsed";

//Fallback values when no settings are provided
const DEFAULT_WIDGET_WIDTH = 280;
const DEFAULT_WIDGET_HEIGHT = 72;
const DEFAULT_ANIMATION_DURATION = 300;
const DEFAULT_BACKGROUND_OPACITY = 0.5;
const DEFAULT_SHOW_ARTIST = true;
const DEFAULT_SHOW_CONTROLS = true;
const COMPACT_LAYOUT_WIDTH = 260;
const COMPACT_LAYOUT_HEIGHT = 88;
const MIN_CONTROL_ICON_SIZE = 10;
const MAX_CONTROL_ICON_SIZE = 16;
const MIN_COVER_SIZE = 24;
const MAX_COVER_SIZE = 64;

export const MediaWidget = GObject.registerClass(
  class MediaWidget extends St.BoxLayout {
    _init(settings = null) {
      super._init({
        style_class: StyleClassNames.MediaWidget,
        vertical: true,
        x_expand: true,
        y_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._settings = settings;
      this._settingSignals = [];
      this._lastArtUrl = null;
      this._lastAverageColors = null;

      this.createWidgets();
      this.assembleLayout();
      this.initButtonCallbacks();
      this.connectSettings();
    }

    connectSettings() {
      if (!this._settings) {
        return;
      }

      const watch = (key, handler) => {
        handler(); //aply
        this._settingSignals.push(
          this._settings.connect(`changed::${key}`, handler),
        );
      };

      watch("show-artist", () => this.applyShowArtist());
      watch("show-controls", () => this.applyShowControls());
      watch("widget-width", () => {
        this.applyResponsiveLayout();
        this.refreshAnimatedSize();
      });
      watch("widget-height", () => {
        this.applyResponsiveLayout();
        this.refreshAnimatedSize();
      });
      watch("background-opacity", () => {
        if (this._lastAverageColors) {
          this.applyBackgroundColor(this._lastAverageColors);
        }
      });
    }

    disconnectSignals() {
      if (!this._settings) {
        return;
      }

      for (const id of this._settingSignals) {
        this._settings.disconnect(id);
      }

      this._settingSignals = [];
    }

    getIntPropertyFromSettings(key, defaultValue) {
      return this._settings ? this._settings.get_int(key) : defaultValue;
    }

    getBoolPropertyFromSettings(key, defaultValue) {
      return this._settings ? this._settings.get_boolean(key) : defaultValue;
    }

    getWidgetWidth() {
      return this.getIntPropertyFromSettings(
        "widget-width",
        DEFAULT_WIDGET_WIDTH,
      );
    }

    getWidgetHeight() {
      return this.getIntPropertyFromSettings(
        "widget-height",
        DEFAULT_WIDGET_HEIGHT,
      );
    }

    getAnimationDuration() {
      return this.getIntPropertyFromSettings(
        "animation-duration",
        DEFAULT_ANIMATION_DURATION,
      );
    }

    getBackgroundOpacity() {
      return this._settings
        ? this._settings.get_double("background-opacity")
        : DEFAULT_BACKGROUND_OPACITY;
    }

    isCompactLayout() {
      return (
        this.getWidgetWidth() <= COMPACT_LAYOUT_WIDTH ||
        this.getWidgetHeight() <= COMPACT_LAYOUT_HEIGHT
      );
    }

    clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
    }

    getControlIconSize() {
      const baseSize = Math.floor(
        Math.min(this.getWidgetWidth(), this.getWidgetHeight()) / 6,
      );

      return this.clamp(baseSize, MIN_CONTROL_ICON_SIZE, MAX_CONTROL_ICON_SIZE);
    }

    getCoverArtSize() {
      const baseSize = Math.floor(
        Math.min(this.getWidgetWidth(), this.getWidgetHeight()) *
          (this.isCompactLayout() ? 0.42 : 0.58),
      );

      return this.clamp(baseSize, MIN_COVER_SIZE, MAX_COVER_SIZE);
    }

    setIconSize(icon, size) {
      if (!icon) {
        return;
      }

      icon.set_style(`icon-size: ${size}px;`);
    }

    applyResponsiveLayout() {
      if (!this._mainContainer) {
        return;
      }

      const compact = this.isCompactLayout();
      const controlIconSize = this.getControlIconSize();
      const coverArtSize = this.getCoverArtSize();

      this._mainContainer.vertical = compact;
      this._mainContainer.spacing = compact ? 8 : 12;

      this._rightContainer.vertical = true;
      this._rightContainer.spacing = compact ? 4 : 0;
      this._rightContainer.x_expand = true;
      this._rightContainer.y_expand = true;

      this._mediaTitle.y_align = compact
        ? Clutter.ActorAlign.CENTER
        : Clutter.ActorAlign.START;
      this._mediaTitle.x_align = compact
        ? Clutter.ActorAlign.CENTER
        : Clutter.ActorAlign.START;
      this._mediaTitle.x_expand = true;

      this._rightContainerBottomRow.vertical = compact;
      this._rightContainerBottomRow.spacing = compact ? 4 : 8;
      this._rightContainerBottomRow.y_align = compact
        ? Clutter.ActorAlign.CENTER
        : Clutter.ActorAlign.END;

      this._artistName.y_align = Clutter.ActorAlign.CENTER;
      this._artistName.x_align = compact
        ? Clutter.ActorAlign.CENTER
        : Clutter.ActorAlign.START;
      this._artistName.x_expand = true;

      this._playbackControls.vertical = compact;
      this._playbackControls.spacing = compact ? 2 : 4;
      this._playbackControls.x_align = compact
        ? Clutter.ActorAlign.CENTER
        : Clutter.ActorAlign.END;
      this._playbackControls.y_align = Clutter.ActorAlign.CENTER;

      this._albumCoverArt.x_align = Clutter.ActorAlign.CENTER;
      this._albumCoverArt.y_align = Clutter.ActorAlign.CENTER;
      this._albumCoverArt.set_size(coverArtSize, coverArtSize);

      this.setIconSize(this._playIcon, controlIconSize);
      this.setIconSize(this._pauseIcon, controlIconSize);
      this.setIconSize(this._previousIcon, controlIconSize);
      this.setIconSize(this._nextIcon, controlIconSize);
      this.setIconSize(this._albumCoverArtFallbackIcon, controlIconSize + 2);

      this._mainContainer.queue_relayout();
      this._rightContainer.queue_relayout();
      this._rightContainerBottomRow.queue_relayout();
      this._playbackControls.queue_relayout();
      this.queue_relayout();
    }

    refreshAnimatedSize() {
      if (this._currentStatus === COLLAPSED) {
        return;
      }

      this.remove_all_transitions();
      this.ease({
        width: this.getWidgetWidth(),
        height: this.getWidgetHeight(),
        duration: this.getAnimationDuration(),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    applyShowArtist() {
      const show = this.getBoolPropertyFromSettings(
        "show-artist",
        DEFAULT_SHOW_ARTIST,
      );
      if (show) {
        this._artistName.show();
      } else {
        this._artistName.hide();
      }

      this.applyResponsiveLayout();
      this.refreshAnimatedSize();
    }

    applyShowControls() {
      const show = this.getBoolPropertyFromSettings(
        "show-controls",
        DEFAULT_SHOW_CONTROLS,
      );
      if (show) {
        this._playbackControls.show();
      } else {
        this._playbackControls.hide();
      }

      this.applyResponsiveLayout();
      this.refreshAnimatedSize();
    }

    setMediaController(mediaController) {
      this._mediaController = mediaController;
    }

    createWidgets() {
      this._mainContainer = new St.BoxLayout({
        style_class: StyleClassNames.MainContainer,
        vertical: false,
        x_expand: false,
        y_expand: false,
        clip_to_allocation: true,
      });

      // Widget layout is split into 2 main containers: left (album cover art) and right (metadata and controls)

      // ----- RIGHT CONTAINER -----

      // Right container is further split into top (media title) and bottom (further split into left (artist) and right (playback controls))
      this._rightContainer = new St.BoxLayout({
        style_class: StyleClassNames.RightContainer,
        vertical: true,
        x_expand: true,
        y_expand: true,
      });

      //Title at the top of the right container
      this._mediaTitle = new St.Label({
        style_class: StyleClassNames.MediaTitle,
        text: "Unknown Title",
        y_align: Clutter.ActorAlign.START,
        y_expand: true,
        x_expand: false,
      });

      this._mediaTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

      //Bottom row of the right container - contains artist name and playback controls
      this._rightContainerBottomRow = new St.BoxLayout({
        style_class: StyleClassNames.RightContainerBottomRow,
        vertical: false,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.END,
      });

      //Left side of the bottom row - artist name
      this._artistName = new St.Label({
        style_class: StyleClassNames.ArtistLabel,
        text: "Unknown Artist",
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });

      this._artistName.clutter_text.ellipsize = Pango.EllipsizeMode.END;

      // ----- PLAYBACK CONTROLS -----

      //Right side of the bottom row - playback controls
      this._playbackControls = new St.BoxLayout({
        style_class: StyleClassNames.PlaybackControls,
        vertical: false,
        x_expand: false,
        x_align: Clutter.ActorAlign.END,
        y_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._previousButton = new St.Button({
        style_class: StyleClassNames.PreviousButton,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._playPauseButton = new St.Button({
        style_class: StyleClassNames.PlayPauseButton,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._nextButton = new St.Button({
        style_class: StyleClassNames.NextButton,
        y_align: Clutter.ActorAlign.CENTER,
      });

      //Playback icons
      this._playIcon = new St.Icon({
        icon_name: "media-playback-start-symbolic",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._pauseIcon = new St.Icon({
        icon_name: "media-playback-pause-symbolic",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._previousIcon = new St.Icon({
        icon_name: "media-skip-backward-symbolic",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._nextIcon = new St.Icon({
        icon_name: "media-skip-forward-symbolic",
        y_align: Clutter.ActorAlign.CENTER,
      });

      // ----- LEFT CONTAINER -----

      //Cover art container on the left side of the widget
      this._albumCoverArt = new St.Bin({
        style_class: StyleClassNames.AlbumCoverArt,
        y_align: Clutter.ActorAlign.CENTER,
        clip_to_allocation: true,
      });

      //Used when we cannot fetch cover art (or if none is available)
      this._albumCoverArtFallbackIcon = new St.Icon({
        icon_name: "audio-x-generic-symbolic",
        y_align: Clutter.ActorAlign.CENTER,
      });
    }

    assembleLayout() {
      //Bottom row - artist name on the left, playback controls on the right
      this._rightContainerBottomRow.add_child(this._artistName);
      this._rightContainerBottomRow.add_child(this._playbackControls);

      //Right container - title on top, bottom row below
      this._rightContainer.add_child(this._mediaTitle);
      this._rightContainer.add_child(this._rightContainerBottomRow);

      //Playback control buttons (Changing order here will change their order in the UI)
      this._playbackControls.add_child(this._previousButton);
      this._playbackControls.add_child(this._playPauseButton);
      this._playbackControls.add_child(this._nextButton);

      //Setting icons for playback control buttons
      this._previousButton.set_child(this._previousIcon);
      this._playPauseButton.set_child(this._playIcon);
      this._nextButton.set_child(this._nextIcon);

      //Album cover art fallback - we add the fallback by default, since it will be overriden when we
      //load actual cover art
      this._albumCoverArt.set_child(this._albumCoverArtFallbackIcon);

      //Main widget layout - left (cover art) and right (metadata and controls)
      this._mainContainer.add_child(this._albumCoverArt);
      this._mainContainer.add_child(this._rightContainer);

      //Attach main container to this widget
      this.add_child(this._mainContainer);
    }

    initButtonCallbacks() {
      //#TODO: Gray out buttons when playback controls are not available

      this._playPauseButton.connect("clicked", () => {
        this._mediaController.toggleStatus();
      });

      this._nextButton.connect("clicked", () => {
        this._mediaController.goNext();
      });

      this._previousButton.connect("clicked", () => {
        this._mediaController.goPrevious();
      });
    }

    canUsePlaybackControls() {
      //#TODO: Add MPRIS check for CanGoNext, CanGoPrevious...
      return this._mediaController !== null;
    }

    updateUI(metadata, status) {
      //#TODO: Animate transition
      //Force string conversion
      this._mediaTitle.set_text(String(metadata.title || TITLE_FALLBACK));
      this._artistName.set_text(String(metadata.artist || ARTIST_FALLBACK));

      //Only reload art cover when the URL changes to avoid unnecessary fetch calls
      if (metadata.artUrl && metadata.artUrl !== this._lastArtUrl) {
        this._lastArtUrl = metadata.artUrl;
        this.setupWidgetStyle(metadata.artUrl).catch((err) => {
          logError(err, "Failed to load album art");
          this.enableFallbackStyle();
        });
      } else if (!metadata.artUrl) {
        this._lastArtUrl = null;
        this.enableFallbackStyle();
      }

      this.updatePlayPauseButton(status);
    }

    updatePlayPauseButton(status) {
      //#TODO: Animate

      if (status === "Playing") {
        this._playPauseButton.set_child(this._pauseIcon);
      } else {
        this._playPauseButton.set_child(this._playIcon);
      }
    }

    async loadPixbufFromUrl(artUrl) {
      let file;
      if (artUrl.startsWith("file://") || artUrl.startsWith("http")) {
        file = Gio.File.new_for_uri(artUrl);
      } else {
        file = Gio.File.new_for_path(artUrl);
      }

      try {
        const inputStream = await new Promise((resolve, reject) => {
          file.read_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
              resolve(source.read_finish(result));
            } catch (e) {
              reject(e);
            }
          });
        });

        const pixBuf = await new Promise((resolve, reject) => {
          GdkPixbuf.Pixbuf.new_from_stream_async(
            inputStream,
            null,
            (source, result) => {
              try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
              } catch (e) {
                reject(e);
              }
            },
          );
        });

        return { pixBuf, file };
      } catch (e) {
        logError(e);
        throw e;
      }
    }

    async setupWidgetStyle(artUrl) {
      try {
        const { pixBuf, file } = await this.loadPixbufFromUrl(artUrl);

        const fileIcon = new Gio.FileIcon({ file });
        this._albumCoverArt.set_child(
          new St.Icon({
            gicon: fileIcon,
            y_align: Clutter.ActorAlign.CENTER,
          }),
        );

        this.setTextLabelColors(pixBuf);
      } catch (e) {
        logError(e, "Failed to load cover art from " + artUrl);
        this.enableFallbackStyle();
      }
    }

    setTextLabelColor(textWidget, color) {
      textWidget.set_style(`color: ${color};`);
    }

    setTextLabelColors(pixBuf) {
      const averageColors = CoverArtHelpers.getAverageRGB(pixBuf);
      this._lastAverageColors = averageColors;
      this.applyBackgroundColor(averageColors);

      const isDark = CoverArtHelpers.isDark(averageColors);
      this.setTextLabelColor(
        this._mediaTitle,
        isDark ? DefaultColors.MediaTitleLight : DefaultColors.MediaTitleDark,
      );
      this.setTextLabelColor(
        this._artistName,
        isDark ? DefaultColors.ArtistNameLight : DefaultColors.ArtistNameDark,
      );
    }

    applyBackgroundColor(color) {
      const opacity = this.getBackgroundOpacity();
      this.set_style(
        `background-color: rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity.toFixed(2)});`,
      );
    }

    enableFallbackStyle() {
      this._lastAverageColors = null;
      this.set_style(`background-color: ${DefaultColors.FallbackBackground};`);
      this._mediaTitle.set_style(`color: ${DefaultColors.MediaTitleLight};`);
      this._artistName.set_style(`color: ${DefaultColors.ArtistNameLight};`);
      this._albumCoverArt.set_child(this._albumCoverArtFallbackIcon);
    }

    //Starts expand animation of the whole widget
    expandContainer() {
      if (this._currentStatus === EXPANDED) return;

      this.show();
      this._currentStatus = EXPANDED;
      this.remove_all_transitions();
      this.set_width(0);
      this.set_height(0);
      this.set_opacity(0);

      this.ease({
        width: this.getWidgetWidth(),
        height: this.getWidgetHeight(),
        opacity: 255,
        duration: this.getAnimationDuration(),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    //Starts collapse animation of the whole widget - also calls callback when completed
    collapseContainer(callback) {
      if (this._currentStatus === COLLAPSED) return;

      this._currentStatus = COLLAPSED;
      this.remove_all_transitions();

      this.ease({
        width: 0,
        height: 0,
        opacity: 0,
        duration: this.getAnimationDuration(),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          if (this._currentStatus === COLLAPSED) {
            this.hide();
          }

          if (typeof callback === "function") {
            callback();
          }
        },
      });
    }
  },
);
