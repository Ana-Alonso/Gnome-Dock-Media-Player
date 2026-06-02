/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { MediaWidget } from "./Core/MediaWidget.js";
import { MediaController } from "./Core/MediaController.js";
import { MediaStatus } from "./Core/MediaControllerHelpers.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import GLib from "gi://GLib";

export default class DockMediaPlayerExtension extends Extension {
  enable() {
    this._settings = this.getSettings();

    this._mediaWidget = new MediaWidget(this._settings);
    this._mediaController = new MediaController(
      (busName, newStatus, trackInfo) => {
        this.onMediaStatusChanged(busName, newStatus, trackInfo);
      },
    );

    this._mediaWidget.setMediaController(this._mediaController);

    this._dashBox = null;
    this._settingsSignalIds = [];
    this._settingsSignalIds.push(
      this._settings.connect("changed::widget-position", () => {
        this.repositionWidget();
      }),
    );

    this.insertIntoDash();
  }

  insertIntoDash() {
    const isCompatibleDock = (actor) => {
      return (
        actor &&
        actor.get_name() === "dashtodockContainer" &&
        actor.dash &&
        actor.dash._box
      );
    };

    const attach = (actor) => {
      if (!this._mediaWidget.get_parent()) {
        this.attachMediaWidget(actor);
      }
    };

    const existingDash = Main.uiGroup
      .get_children()
      .find((actor) => isCompatibleDock(actor));

    if (existingDash) {
      attach(existingDash);
      return;
    }

    this._dashAddedID = Main.uiGroup.connect("child-added", (_, actor) => {
      if (isCompatibleDock(actor)) {
        Main.uiGroup.disconnect(this._dashAddedID);
        this._dashAddedID = null;

        attach(actor);
      }
    });
  }

  onMediaStatusChanged(busName, newStatus, trackInfo) {
    if (!this._mediaWidget) {
      return;
    }

    if (newStatus === MediaStatus.PLAYING || newStatus === MediaStatus.PAUSED) {
      if (!trackInfo) {
        logError("Track info is null, but media status is playing or paused");
        this._mediaWidget.collapseContainer(() => {});

        return;
      }

      this._mediaWidget.expandContainer();
      this._mediaWidget.updateUI(trackInfo, newStatus, busName);
    } else {
      this._mediaWidget.collapseContainer(() => {});
    }
  }

  attachMediaWidget(dashToDock) {
    const dash = dashToDock.dash;
    this._dashBox = dash._box;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const iconSize = dash.iconSize ?? 32;
      this._mediaWidget._albumCoverArt.set_size(iconSize, iconSize);
      return GLib.SOURCE_REMOVE;
    });

    this.insertWidgetIntoDashBox();

    this._mediaWidget.set_x_expand(false);
    this._mediaWidget.set_y_expand(false);
    this._mediaWidget.collapseContainer(() => {});

    this._mediaController.startWatching();
  }

  insertWidgetIntoDashBox() {
    if (!this._dashBox || !this._mediaWidget) {
      return;
    }

    //Remove from current parent if we already attached the widget
    if (this._mediaWidget.get_parent() == this._dashBox) {
      this._dashBox.remove_child(this._mediaWidget);
    }

    const position = this._settings.get_string("widget-position");
    if (position === "start") {
      this._dashBox.insert_child_at_index(this._mediaWidget, 0);
    } else {
      this._dashBox.add_child(this._mediaWidget);
    }
  }

  //Called when we change widget position at runtime
  repositionWidget() {
    if (!this._dashBox || !this._mediaWidget) {
      return;
    }

    this.insertWidgetIntoDashBox();
  }

  disable() {
    if (this._settings) {
      for (const id of this._settingsSignalIds) {
        this._settings.disconnect(id);
      }

      this._settingsSignalIds = [];
    }

    if (this._dashAddedID) {
      Main.uiGroup.disconnect(this._dashAddedID);
      this._dashAddedID = null;
    }

    if (this._mediaWidget) {
      this._mediaWidget.disconnectSignals();

      this._mediaWidget.collapseContainer(() => {
        if (this._mediaWidget && this._mediaWidget.get_parent()) {
          this._mediaWidget.get_parent().remove_child(this._mediaWidget);
        }

        this._mediaWidget = null;
      });
    }

    if (this._mediaController) {
      this._mediaController.destroy();
      this._mediaController = null;
    }

    this._dashBox = null;
    this._settings = null;
  }
}
