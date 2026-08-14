/**
 * PERK CARDS — pick one of three.
 *
 * Freezes the fight while it is up, for the same reason the genre it is copied
 * from does: the choice is the reward, and a choice made while something is
 * eating you is not a choice. It holds `time.scale` at zero and releases the
 * pointer, exactly like the pause menu — and it deliberately CANNOT be dismissed
 * without picking, so there is no path that leaves the game frozen with no cards
 * on screen.
 *
 * Keyboard 1/2/3 as well as clicks, and the cards are 44px-plus targets under a
 * coarse pointer, because this is the one modal a touch player has to operate
 * mid-run.
 */

const CSS = `
.ow-perk{position:absolute;inset:0;z-index:55;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:calc(var(--u)*5);
  background:linear-gradient(rgba(4,7,11,.86),rgba(4,7,11,.94));
  backdrop-filter:blur(calc(4px*var(--k)));pointer-events:auto}
.ow-perk h2{font-family:var(--fd);font-size:calc(26px*var(--k));letter-spacing:.24em;
  color:var(--ink);text-transform:uppercase}
.ow-perk .sub{font-size:calc(11px*var(--k));letter-spacing:.24em;color:var(--ink-3);
  margin-top:calc(var(--u)*-3)}
.ow-perk .cards{display:flex;gap:calc(var(--u)*4);flex-wrap:wrap;justify-content:center;
  padding:0 calc(var(--u)*4);max-width:100%}
.ow-perk .card{appearance:none;cursor:pointer;text-align:left;
  width:calc(210px*var(--k));min-height:calc(128px*var(--k));
  padding:calc(var(--u)*3.4) calc(var(--u)*3.4);
  background:rgba(16,22,30,.92);border:1px solid var(--hair);
  border-left:calc(3px*var(--k)) solid var(--amber);border-radius:calc(6px*var(--k));
  color:var(--ink);font-family:var(--ff);display:flex;flex-direction:column;gap:calc(var(--u)*1.6);
  transition:background .12s,border-color .12s,transform .12s}
.ow-perk .card:hover,.ow-perk .card:focus-visible{background:rgba(30,42,56,.95);
  border-color:rgba(255,255,255,.45);transform:translateY(calc(-2px*var(--k)));outline:none}
.ow-perk .card k{font-size:calc(9.5px*var(--k));letter-spacing:.22em;color:var(--ink-3);
  text-transform:uppercase}
.ow-perk .card b{font-size:calc(15px*var(--k));font-weight:600;letter-spacing:.04em}
.ow-perk .card i{font-style:normal;font-size:calc(11.5px*var(--k));color:var(--ink-2);line-height:1.45}
@media (pointer:coarse){.ow-perk .card{min-height:calc(132px*var(--k))}}
@media (max-width:720px){.ow-perk .cards{flex-direction:column}
  .ow-perk .card{width:min(360px,86vw);min-height:0}}
`;

export class PerkCard {
  constructor(parent, ctx) {
    this.ctx = ctx;
    if (!document.getElementById('ow-perk-style')) {
      const s = document.createElement('style');
      s.id = 'ow-perk-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.className = 'ow-perk';
    this.root.style.display = 'none';
    this.root.innerHTML =
      `<h2>Supply Chest</h2><div class="sub">Choose one</div><div class="cards"></div>`;
    this.cards = this.root.querySelector('.cards');
    parent.appendChild(this.root);
    this.open = false;
    this._onKey = (e) => {
      if (!this.open) return;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
      if (n === undefined) return;
      e.preventDefault();
      const b = this.cards.children[n];
      if (b) b.click();
    };
    addEventListener('keydown', this._onKey);
  }

  /**
   * @param {Array<{id:string,label:string,desc:string}>} offers
   * @param {(id:string)=>void} onPick
   */
  show(offers, onPick) {
    if (this.open || !offers?.length) return;
    this.cards.textContent = '';
    offers.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.innerHTML = `<k>${i + 1}</k><b></b><i></i>`;
      b.querySelector('b').textContent = o.label;
      b.querySelector('i').textContent = o.desc;
      b.addEventListener('click', () => {
        onPick?.(o.id);
        this.close();
      });
      this.cards.appendChild(b);
    });
    this.root.style.display = '';
    this.open = true;
    this._prevScale = this.ctx.time.scale;
    this.ctx.time.scale = 0;
    // Same sequence the pause menu uses: suppress the re-lock FIRST, then exit,
    // or the next click re-grabs the cursor and the card cannot be clicked.
    if (this.ctx.input) this.ctx.input.lockSuppressed = true;
    document.exitPointerLock?.();
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.cards.firstElementChild?.focus();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    // Restore what was there rather than assuming 1: the pause menu may have
    // been holding zero underneath, and stamping 1 here would unfreeze a game
    // the player had deliberately paused.
    this.ctx.time.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    // Only hand the cursor back if no other modal still wants it — the pause
    // menu may be underneath.
    const menuOpen = this.ctx.peek('ui')?.menu?.open;
    if (this.ctx.input && !menuOpen) {
      this.ctx.input.lockSuppressed = false;
      this.ctx.input.requestPointerLock?.();
    }
  }

  dispose() {
    removeEventListener('keydown', this._onKey);
    this.root.remove();
  }
}
