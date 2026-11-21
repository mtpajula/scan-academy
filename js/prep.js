/* ============================================================
   prep.js — Phase 1: pack the van (limited slots, easy to forget)
   ============================================================ */
window.G = window.G || {};

G.prep = {
  init() {
    G.state.van = [];
    this.render();
    document.getElementById('btn-to-field').onclick = () => {
      G._fieldEntered = true;
      G.field.enter();
      G.showScreen('field');
    };
  },

  has(id) { return G.state.van.includes(id); },

  render() {
    const vanEl = document.getElementById('van-slots');
    const shelfEl = document.getElementById('shelf-list');
    vanEl.innerHTML = '';
    shelfEl.innerHTML = '';
    document.getElementById('van-count').textContent = G.state.van.length + ' / ' + G.VAN_SLOTS;

    // van slots
    for (let i = 0; i < G.VAN_SLOTS; i++) {
      const id = G.state.van[i];
      const div = document.createElement('div');
      if (id) {
        const item = G.EQUIPMENT.find(e => e.id === id);
        div.className = 'item';
        div.innerHTML = `<div class="nm">${item.name}</div><div class="ds">${item.desc}</div>`;
        div.title = 'Click to unload back to the shelf';
        div.onclick = () => { G.state.van.splice(i, 1); this.render(); };
      } else {
        div.className = 'item slot-empty';
        div.textContent = 'empty slot';
      }
      vanEl.appendChild(div);
    }
    // shelf
    for (const item of G.EQUIPMENT) {
      if (G.state.van.includes(item.id)) continue;
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="nm">${item.name}</div><div class="ds">${item.desc}</div>`;
      div.title = 'Click to load into the van';
      div.onclick = () => {
        if (G.state.van.length >= G.VAN_SLOTS) {
          G.toast('🚐 The van is full! (' + G.VAN_SLOTS + ' slots) — unload something first.');
          return;
        }
        G.state.van.push(item.id);
        this.render();
      };
      shelfEl.appendChild(div);
    }
  },
};
