import { el, setText, setStyle, clamp01 } from './util.js';

/**
 * Survivor readout, bottom left.
 *
 *   LVL 4              37 KILLS
 *   ============------          xp toward the next upgrade
 *   ========                    armour, only while you have some
 *
 * The progression is invisible without this. Kills feed XP and XP feeds the
 * upgrade card, but from inside the game that whole economy is a card that
 * occasionally appears for no stated reason — you cannot tell whether a fight
 * moved you toward the next one, so there is nothing to push for. A bar that
 * visibly fills is the entire feedback loop.
 *
 * The armour row hides itself at zero rather than sitting there empty: bare
 * health is the normal state, and a permanently drawn empty bar reads as a
 * broken widget. It appearing at all is the signal that you have a plate.
 *
 * Mirrors the ammo panel's construction (see ammo.js) so the two corners share
 * a visual language — same ink levels, same understatement, no boxes.
 */
export class SurvivorPanel {
  constructor(parent) {
    this.root = el('div', 'ow-surv', parent);

    const head = el('div', 'ow-surv-head', this.root);
    this.lvl = el('div', 'ow-surv-lvl', head);
    this.kills = el('div', 'ow-surv-kills', head);

    this.xpTrack = el('div', 'ow-surv-track', this.root);
    this.xpFill = el('div', 'ow-surv-fill', this.xpTrack);

    this.armorTrack = el('div', 'ow-surv-track ow-surv-armor', this.root);
    this.armorFill = el('div', 'ow-surv-fill', this.armorTrack);

    this._lvl = -1;
    this._kills = -1;
    // Eased so a level-up drains the bar rather than snapping it, which is the
    // only moment this widget is actually being watched.
    this._xp = 0;
    this._armor = 0;
  }

  update(dt, perks) {
    if (!perks) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    setStyle(this.root, 'display', '');

    if (perks.plevel !== this._lvl) {
      this._lvl = perks.plevel;
      setText(this.lvl, `LVL ${this._lvl}`);
    }
    if (perks.kills !== this._kills) {
      this._kills = perks.kills;
      setText(this.kills, `${this._kills} KILLS`);
    }

    // Damp toward the target so both bars move rather than teleport. A level-up
    // is a drop from full to near-empty and it should be seen happening.
    const k = Math.min(1, dt * 9);
    this._xp += (clamp01(perks.xp / Math.max(1, perks.xpToNext)) - this._xp) * k;
    this._armor += (clamp01(perks.armor / Math.max(1, perks.armorMax)) - this._armor) * k;

    setStyle(this.xpFill, 'width', `${(this._xp * 100).toFixed(1)}%`);
    setStyle(this.armorTrack, 'opacity', this._armor > 0.005 ? '1' : '0');
    setStyle(this.armorFill, 'width', `${(this._armor * 100).toFixed(1)}%`);
  }

  dispose() {
    this.root.remove();
  }
}
