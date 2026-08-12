import { el, setText, setStyle, damp, ease } from './util.js';
import { OPTIC_ORDER } from '../weapons/optics.js';
import { MUZZLE_ORDER } from '../weapons/muzzles.js';
import { MAG_ORDER } from '../weapons/mags.js';
import { STOCK_ORDER } from '../weapons/stocks.js';
import { SKIN_ORDER, SKINS } from '../weapons/skins.js';
import { t, rankName } from '../core/i18n.js';
import { career, level, nextUnlock, isUnlocked, unlockPrice } from '../core/save.js';

/**
 * GUNSMITH — the loadout, in the game, with the gun in shot.
 *
 * This used to be five rows buried in the pause menu between the shadow toggle
 * and the mouse sensitivity slider, which is where you put a debug control, not
 * where you put the reward for eighty kills. Attachments are the entire
 * progression economy now (see core/save.js); they need a screen that treats
 * them as content.
 *
 * The panel docks LEFT for one reason: the viewmodel sits bottom-right, so
 * everything the player is choosing between stays visible while they choose it.
 * Nothing is rebuilt when a part is fitted — every muzzle, magazine, stock and
 * optic was built at load and this flips which one is visible (see
 * weapons/index.js), so the change lands on the weapon in your hands instantly
 * and you are looking at the real thing, not a preview of it.
 *
 * ponytail: it freezes the world exactly like the pause menu rather than running
 * the fight at a slowed scale behind it. A live gunsmith reads better and is a
 * real design in a real game, but it means the player can be shot while
 * browsing a menu, which needs a whole safety story (open only when out of
 * combat? invulnerable while open?) to not be infuriating. Freezing is the
 * boring answer and it is correct until somebody asks for the other one.
 */

const MUZZLE_LABELS = { bare: 'bare', a2: 'a2', brake: 'brake', comp: 'comp', can: 'can', trilug: 'trilug' };
const MAG_LABELS = { short: 'short', std: 'std', ext: 'ext' };
const STOCK_LABELS = { collapsed: 'short', standard: 'std', extended: 'long' };
const OPTIC_LABELS = { irons: 'irons', reddot: 'dot', okp7: 'okp-7', acog: '4x', vari: '1-6x' };

export class Gunsmith {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.open = false;
    this.shown = 0;

    this.root = el('div', 'ow-gun', parent);
    const inner = el('div', 'ow-gun-inner', this.root);

    el('h1', null, inner, t('gun.title'));
    this.sub = el('div', 'ow-gun-sub', inner, '');
    el('div', 'rule', inner);

    /**
     * Career strip, at the top of the screen the unlocks are spent on. Showing
     * "12 more eliminations" next to the part it buys is the whole reason the
     * progression reads as progression rather than as arbitrary greyed buttons.
     */
    this.career = el('div', 'ow-gun-career', inner);

    this.rows = el('div', null, inner);

    /** @type {Array<{slot:string, btns:Array, note:HTMLElement|null}>} */
    this.slots = [];
    this._slot('optic', t('gun.optic'), OPTIC_ORDER, (id) => OPTIC_LABELS[id] ?? id, true);
    this._slot('muzzle', t('gun.muzzle'), [...MUZZLE_ORDER, 'trilug'], (id) => MUZZLE_LABELS[id] ?? id, true);
    this._slot('mag', t('gun.mag'), MAG_ORDER, (id) => MAG_LABELS[id] ?? id, true);
    this._slot('stock', t('gun.stock'), STOCK_ORDER, (id) => STOCK_LABELS[id] ?? id, true);
    this._slot('skin', t('gun.finish'), SKIN_ORDER, (id) => SKINS[id].label, false);

    const btns = el('div', 'ow-btns', inner);
    this.doneBtn = el('button', 'ow-btn primary', btns, t('gun.done'));
    this.doneBtn.type = 'button';
    this.doneBtn.addEventListener('click', () => this.close());

    el('div', 'hint', inner, t('gun.hint'));
    setStyle(this.root, 'display', 'none');
  }

  /**
   * One attachment slot: a labelled row of segmented buttons plus a stat note.
   *
   * `withNote` is false for paint, which has no ballistic effect to report — an
   * empty stat column next to a cosmetic reads as a missing number.
   */
  _slot(slot, label, ids, labelOf, withNote) {
    const row = el('div', 'ow-row', this.rows);
    el('div', 'name', row, label);
    const seg = el('div', 'ow-seg', row);
    const btns = [];
    for (const id of ids) {
      const b = el('button', null, seg, labelOf(id));
      b.type = 'button';
      b.addEventListener('click', () => {
        const wp = this.ctx.peek('weapons');
        if (slot === 'optic') wp?.setOptic?.(id);
        else if (slot === 'muzzle') wp?.setMuzzle?.(id);
        else if (slot === 'mag') wp?.setMag?.(id);
        else if (slot === 'stock') wp?.setStock?.(id);
        else wp?.setSkin?.(id);
        this.sync();
      });
      btns.push([b, id]);
    }
    const note = withNote ? el('div', 'val', row, '') : null;
    this.slots.push({ slot, btns, note });
  }

  /**
   * Reconcile every button with three separate facts, which used to be spread
   * across two methods and fought over the same `disabled` flag:
   *
   *   fitted     is this the part currently on the gun
   *   available  does THIS weapon have this part built at all
   *   unlocked   has the career earned it
   *
   * A button is dead if either of the last two fails, and the two failures look
   * different on purpose: unavailable is faded (the weapon simply has no such
   * slot), locked is struck through and carries its price.
   */
  sync() {
    const wp = this.ctx.peek('weapons');
    const built = wp?.viewmodel?.weapons.get(wp.activeId);
    const fittedOf = {
      optic: wp?.opticId ?? null,
      muzzle: wp?.muzzleId ?? null,
      mag: wp?.magId ?? null,
      stock: wp?.stockId ?? null,
      skin: wp?.skinId ?? 'black',
    };
    const setOf = { optic: built?.optics, muzzle: built?.muzzles, mag: built?.mags, stock: built?.stocks };

    for (const { slot, btns, note } of this.slots) {
      for (const [b, id] of btns) {
        // Paint applies to every weapon, so it has no per-weapon availability set.
        const available = slot === 'skin' ? true : !!setOf[slot]?.[id];
        const unlocked = isUnlocked(slot, id);
        b.classList.toggle('on', fittedOf[slot] === id);
        b.classList.toggle('locked', available && !unlocked);
        b.disabled = !available || !unlocked;
        setStyle(b, 'opacity', available ? '' : '0.35');
        if (available && !unlocked) b.title = t('menu.locked.at', { n: unlockPrice(slot, id) });
        else b.removeAttribute('title');
      }
      if (note) setText(note, this._note(slot, wp));
    }

    setText(this.sub, wp?.current?.name ?? '');

    const c = career();
    const next = nextUnlock();
    /**
     * Label first, count second — "ELIMINATIONS: 1", not "1 ELIMINATIONS".
     * Sidesteps noun agreement entirely, which matters because Russian has three
     * plural forms and a full pluralisation table would be more code than this
     * whole panel.
     */
    setText(
      this.career,
      `${rankName(level())} · ${t('career.kills')}: ${c.kills} · ${
        next ? t('career.next.at', { n: next.at - c.kills }) : t('career.complete')
      }`
    );
  }

  /** The one stat each slot is actually chosen on. */
  _note(slot, wp) {
    if (!wp) return '';
    if (slot === 'optic') return wp.opticMagRange ? `${wp.adsMagnification.toFixed(1)}x · wheel` : '';
    if (slot === 'muzzle') return wp.muzzle ? `heard ${wp.muzzle.loudness} m` : '';
    if (slot === 'mag') {
      const g = wp.magSpec;
      return g ? `${g.rounds} rds · reload x${g.reload.toFixed(2)}` : '';
    }
    if (slot === 'stock') {
      const st = wp.stockSpec;
      return st ? `recoil x${st.recoil.toFixed(2)}` : '';
    }
    return '';
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.sync();
    setStyle(this.root, 'display', '');
    if (this.ctx.input) this.ctx.input.lockSuppressed = true;
    document.exitPointerLock?.();
    const time = this.ctx.time;
    if (time) {
      this._prevScale = time.scale;
      time.scale = 0;
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
    // Same event the pause menu raises: the portal's gameplay bracket, the touch
    // overlay and the career bank all key off it and none of them care which
    // menu is up.
    this.ctx.events.emit('ui:pause', { paused: true });
    // After the emit — banking happens on it, so an unlock earned this minute is
    // in the career before the buttons are gated. See the same note in menu.js.
    this.sync();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    const time = this.ctx.time;
    if (time) time.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    if (this.ctx.input) this.ctx.input.lockSuppressed = false;
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  /** Unscaled, so the fade runs while the game is frozen. */
  update(rawDt) {
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose() {
    this.root.remove();
  }
}
