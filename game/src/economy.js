// The economy: money earned by kills, plants and round results, and spent
// in the buy menu between rounds. Prices match the weapon definitions; the
// buy menu only offers what the player can afford and does not already own.
import { WEAPONS, GRENADE } from './weapons.js';

export const START_MONEY = 800;
export const WIN_BONUS = 325;
export const LOSS_BONUS = 190;
export const KILL_BONUS = 300;
export const PLANT_BONUS = 300;

export function createEconomy() {
  let money = START_MONEY;
  let grenades = 0;

  function buyList() {
    return [
      ...Object.values(WEAPONS).map((def) => ({ kind: 'weapon', id: def.id, name: def.name, price: def.price })),
      { kind: 'grenade', id: 'grenade', name: GRENADE.name, price: GRENADE.price },
    ];
  }

  return {
    get money() {
      return money;
    },
    get grenades() {
      return grenades;
    },
    resetMatch() {
      money = START_MONEY;
      grenades = 0;
    },
    resetRound() {
      grenades = 0;
    },
    add(amount) {
      money += amount;
    },
    canAfford(price) {
      return money >= price;
    },
    buy(item) {
      if (money < item.price) return false;
      money -= item.price;
      if (item.kind === 'grenade') grenades += 1;
      return true;
    },
    useGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    buyList,
  };
}
