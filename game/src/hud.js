// The DOM HUD: crosshair, hit marker, top bar (timer, score, bomb status),
// kill feed, health, money, ammo, the plant/defuse channel bar, the round
// banner, the buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads the button callbacks out.
// Every setter caches its last value so the DOM is only written on change.
const OVERLAY_COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Foundry Yard. Five attackers against five defenders. Plant the spark at Furnace or Crane, or wipe the Ash team. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyValue = $('money-value');
  const grenadeValue = $('grenade-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const roundTimer = $('round-timer');
  const roundLabel = $('round-label');
  const scoreEmber = $('score-ember');
  const scoreAsh = $('score-ash');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const channel = $('channel');
  const channelLabel = $('channel-label');
  const channelFill = $('channel-fill');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const flash = $('flash');
  const damageVignette = $('damage-vignette');
  const spectateNote = $('spectate-note');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastGrenades = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastWeapon = '';
  let lastBomb = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let buyOpen = false;
  let buyHandler = null;

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve === 999 ? '∞' : reserve}`;
      weaponName.textContent = name;
    },
    setHealth(value) {
      const hp = Math.max(0, Math.round(value));
      if (hp === lastHealth) return;
      lastHealth = hp;
      healthNum.textContent = String(hp);
      healthFill.style.width = `${hp}%`;
      healthFill.classList.toggle('low', hp <= 30);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setGrenades(value) {
      if (value === lastGrenades) return;
      lastGrenades = value;
      grenadeValue.textContent = `◉ ×${value}`;
    },
    setTimer(seconds, phase) {
      const shown = Math.max(0, Math.ceil(seconds));
      if (shown === lastTimer) return;
      lastTimer = shown;
      const minutes = Math.floor(shown / 60);
      const secs = shown % 60;
      roundTimer.textContent = `${minutes}:${String(secs).padStart(2, '0')}`;
      roundLabel.textContent = phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND' : phase === 'roundEnd' ? 'ROUND END' : phase === 'matchEnd' ? 'MATCH' : phase;
      roundTimer.classList.toggle('urgent', shown <= 10 && phase === 'live');
    },
    setScore(ember, ash, round) {
      const key = `${ember}-${ash}-${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreEmber.textContent = String(ember);
      scoreAsh.textContent = String(ash);
      roundLabel.dataset.round = `R${round}`;
    },
    setBombStatus(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('on', text.length > 0);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(html) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      entry.innerHTML = html;
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.classList.add('fade'), 4200);
    },
    showChannel(label, progress) {
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideChannel() {
      channel.hidden = true;
    },
    banner(title, sub, holdMs = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    flash() {
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
    },
    damageFlash() {
      damageVignette.classList.remove('go');
      void damageVignette.offsetWidth;
      damageVignette.classList.add('go');
    },
    showSpectate(name) {
      spectateNote.hidden = false;
      spectateNote.textContent = `Eliminated — spectating ${name}`;
    },
    hideSpectate() {
      spectateNote.hidden = true;
    },
    showBuy(items, money, owned) {
      buyOpen = true;
      buyPanel.hidden = false;
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      items.forEach((item, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        const has = owned.has(item.id);
        const afford = money >= item.price;
        row.disabled = has || !afford;
        row.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${item.name}</span><span class="buy-state">${has ? 'OWNED' : `$${item.price}`}</span>`;
        row.addEventListener('click', () => {
          if (buyHandler) buyHandler(item);
        });
        buyList.appendChild(row);
      });
    },
    hideBuy() {
      buyOpen = false;
      buyPanel.hidden = true;
    },
    get buyOpen() {
      return buyOpen;
    },
    showOverlay(mode, data) {
      const text = OVERLAY_COPY[mode];
      if (!text) return;
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = mode === 'matchEnd' && data ? data : text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
