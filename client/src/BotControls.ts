// The "Bots [-] [+]" controls in the pause panel (tag, infection, battle
// royale). After a click, both buttons wait for the server's new bot count
// (or a second) before taking another, so fast clicking can't flood it.

const WAIT_MS = 1000;

// The same control drives "Monsters [-] [+]" in the battle royale (prefix
// "monster": the elements #monster-controls, #monster-count...).
export class BotControls {
  private countEl: HTMLElement;
  private addEl: HTMLButtonElement;
  private removeEl: HTMLButtonElement;
  private count = 0;
  private max = 0;
  private waiting: number | undefined;

  constructor(onBots: (action: "add" | "remove") => void, prefix = "bot") {
    this.countEl = document.getElementById(`${prefix}-count`)!;
    this.addEl = document.getElementById(`${prefix}-add`) as HTMLButtonElement;
    this.removeEl = document.getElementById(`${prefix}-remove`) as HTMLButtonElement;
    const controls = document.getElementById(`${prefix}-controls`)!;
    controls.hidden = false;
    // Clicks here shouldn't fall through to "click to resume". Assigned with
    // onclick (not addEventListener) so the next room's controls replace them.
    controls.onclick = (e) => e.stopPropagation();
    const click = (action: "add" | "remove") => {
      if (this.waiting !== undefined) return;
      this.addEl.disabled = this.removeEl.disabled = true;
      this.waiting = window.setTimeout(() => this.settle(), WAIT_MS);
      onBots(action);
    };
    this.addEl.onclick = () => click("add");
    this.removeEl.onclick = () => click("remove");
  }

  // The server's answer.
  update(count: number, max: number): void {
    this.count = count;
    this.max = max;
    this.countEl.textContent = String(count);
    this.settle();
  }

  private settle(): void {
    window.clearTimeout(this.waiting);
    this.waiting = undefined;
    this.addEl.disabled = this.count >= this.max;
    this.removeEl.disabled = this.count === 0;
  }
}
