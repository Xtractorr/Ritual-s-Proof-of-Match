const FALLBACK_DATASET = [
  { id: 1, image: "ETH" },
  { id: 2, image: "BTC" },
  { id: 3, image: "SOL" },
  { id: 4, image: "AVAX" },
  { id: 5, image: "ARB" },
  { id: 6, image: "OP" },
  { id: 7, image: "MATIC" },
  { id: 8, image: "LINK" },
  { id: 9, image: "UNI" },
  { id: 10, image: "NEAR" },
  { id: 11, image: "ATOM" },
  { id: 12, image: "AAVE" }
];

class SoundEngine {
  constructor() {
    this.context = null;
  }

  ensureContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.context.state === "suspended") {
      this.context.resume().catch(() => {});
    }
  }

  playTone({ frequency, duration, gain = 0.03, type = "sine" }) {
    this.ensureContext();
    if (!this.context) return;

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gainNode = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gainNode.gain.setValueAtTime(gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  playFlip() {
    this.playTone({ frequency: 420, duration: 0.08, gain: 0.02, type: "triangle" });
  }

  playMatch() {
    this.playTone({ frequency: 680, duration: 0.12, gain: 0.03, type: "sine" });
    setTimeout(() => {
      this.playTone({ frequency: 920, duration: 0.13, gain: 0.03, type: "sine" });
    }, 60);
  }
}

class RitualProofOfMatch {
  constructor(dataset) {
    this.dataset = dataset;
    this.level = 1;
    this.boardRows = 2;
    this.boardCols = 2;
    this.score = 0;
    this.streak = 0;

    this.levelStartTime = 0;
    this.timerId = null;
    this.lastTimerTick = 0;
    this.remainingTimeSeconds = 60;
    this.pauseUntilTimestamp = 0;
    this.gameEnded = false;
    this.toastTimeoutId = null;

    this.deck = [];
    this.firstCard = null;
    this.secondCard = null;
    this.inputLocked = false;
    this.matchedPairs = 0;
    this.totalPairs = 0;
    this.levelRules = this.getTimeRules(1);

    this.stats = {
      startedAt: null,
      levels: [],
      totalMatches: 0,
      totalMismatches: 0,
      score: 0
    };

    this.sound = new SoundEngine();

    this.ui = {
      timer: document.getElementById("timerValue"),
      score: document.getElementById("scoreValue"),
      streak: document.getElementById("streakValue"),
      levelPill: document.getElementById("levelPill"),
      board: document.getElementById("gameBoard"),
      progressFill: document.getElementById("progressFill"),
      progressText: document.getElementById("progressText"),
      levelToast: document.getElementById("levelToast"),
      newGameBtn: document.getElementById("newGameBtn")
    };

    this.ui.newGameBtn.addEventListener("click", () => this.startNewGame());

    this.uidCounter = 0;
  }

  createUid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    this.uidCounter += 1;
    return `uid-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${this.uidCounter}`;
  }

  startNewGame() {
    this.level = 1;
    const dimensions = this.getBoardDimensions(this.level);
    this.boardRows = dimensions.rows;
    this.boardCols = dimensions.cols;
    this.score = 0;
    this.streak = 0;
    this.remainingTimeSeconds = 60;
    this.pauseUntilTimestamp = 0;
    this.gameEnded = false;
    if (this.toastTimeoutId) {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
    this.ui.levelToast.classList.remove("show");
    this.stats = {
      startedAt: new Date().toISOString(),
      levels: [],
      totalMatches: 0,
      totalMismatches: 0,
      score: 0
    };

    this.updateHud();
    this.startTimer();
    this.loadLevel(true);
  }

  getBoardDimensions(level) {
    const levelLayouts = [
      { rows: 2, cols: 2 },
      { rows: 2, cols: 3 },
      { rows: 2, cols: 4 },
      { rows: 3, cols: 4 },
      { rows: 4, cols: 4 },
      { rows: 4, cols: 5 },
      { rows: 4, cols: 6 },
      { rows: 5, cols: 6 },
      { rows: 6, cols: 6 },
      { rows: 6, cols: 7 },
      { rows: 6, cols: 8 },
      { rows: 7, cols: 8 },
      { rows: 8, cols: 8 }
    ];

    if (level <= levelLayouts.length) {
      return levelLayouts[level - 1];
    }

    let { rows, cols } = levelLayouts[levelLayouts.length - 1];
    const remainingSteps = level - levelLayouts.length;

    for (let step = 0; step < remainingSteps; step += 1) {
      if (cols <= rows + 2) {
        cols += 1;
      } else {
        rows += 1;
      }

      if ((rows * cols) % 2 !== 0) {
        cols += 1;
      }
    }

    return { rows, cols };
  }

  getCardCountForBoard(rows, cols) {
    return rows * cols;
  }

  async loadLevel(isFreshStart = false) {
    this.levelRules = this.getTimeRules(this.level);
    this.remainingTimeSeconds = this.getLevelTimerSeconds(this.level);
    const dimensions = this.getBoardDimensions(this.level);
    this.boardRows = dimensions.rows;
    this.boardCols = dimensions.cols;
    const cardCount = this.getCardCountForBoard(this.boardRows, this.boardCols);
    this.totalPairs = cardCount / 2;
    this.matchedPairs = 0;
    this.firstCard = null;
    this.secondCard = null;
    this.inputLocked = false;
    this.levelStartTime = performance.now();

    if (!isFreshStart) {
      const ruleNotice = this.getLevelRuleNotice(this.level, this.levelRules);
      if (ruleNotice) {
        this.showLevelToast(`LEVEL ${this.level} · ${ruleNotice}`, {
          durationMs: 4500,
          allowShortDuration: true
        });
      } else {
        this.showLevelToast(`LEVEL ${this.level}`, {
          durationMs: 1000,
          allowShortDuration: true
        });
      }
    }

    this.deck = this.buildDeck(this.totalPairs);
    this.renderBoard();
    this.updateHud();
    this.updateProgress();
  }

  buildDeck(pairCount) {
    const picked = [];
    const pool = this.shuffle([...this.dataset]);

    for (let i = 0; i < pairCount; i += 1) {
      const source = pool[i % pool.length];
      picked.push({
        pairId: `${source.id}-${i}`,
        image: this.resolveCardImage(source.image)
      });
    }

    const duplicated = picked.flatMap((card) => {
      const a = { ...card, uid: this.createUid(), matched: false };
      const b = { ...card, uid: this.createUid(), matched: false };
      return [a, b];
    });

    return this.shuffle(duplicated);
  }

  resolveCardImage(imageField) {
    if (!imageField) return this.generateTokenArt("?");
    if (imageField.startsWith("http") || imageField.startsWith("data:image")) {
      return imageField;
    }
    return this.generateTokenArt(imageField);
  }

  generateTokenArt(label) {
    const palette = [
      ["#2348af", "#6f35e9"],
      ["#0f7fcf", "#00b6ff"],
      ["#2a2f44", "#4c5f8d"],
      ["#4b2ea8", "#993dff"],
      ["#185f88", "#22a9b9"]
    ];

    const index = Math.abs(
      Array.from(label).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    ) % palette.length;

    const [start, end] = palette[index];
    const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='${start}'/>
          <stop offset='100%' stop-color='${end}'/>
        </linearGradient>
      </defs>
      <rect width='240' height='240' rx='22' fill='url(#g)'/>
      <circle cx='178' cy='46' r='32' fill='rgba(255,255,255,0.17)'/>
      <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
        fill='white' font-size='44' font-family='Arial, sans-serif' font-weight='700'>${safeLabel}</text>
    </svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  renderBoard() {
    this.ui.board.style.setProperty("--grid-cols", String(this.boardCols));

    if (!this.deck.length) {
      this.ui.board.innerHTML = `<div class="board-empty">No cards available. Start a new game to retry.</div>`;
      return;
    }

    this.ui.board.innerHTML = this.deck
      .map(
        (card) => `
        <button class="card" data-uid="${card.uid}" data-pair="${card.pairId}" aria-label="Hidden card" role="gridcell">
          <div class="card-inner">
            <div class="card-face card-back"></div>
            <div class="card-face card-front">
              <img src="${card.image}" alt="Memory card symbol" loading="lazy" decoding="async" />
              <span class="match-check">✓</span>
            </div>
          </div>
        </button>`
      )
      .join("");

    // Event delegation avoids many listeners for larger grids.
    this.ui.board.onclick = (event) => {
      const button = event.target.closest(".card");
      if (!button) return;
      this.handleCardClick(button);
    };
  }

  handleCardClick(button) {
    if (
      this.gameEnded ||
      this.inputLocked ||
      button.classList.contains("flipped") ||
      button.classList.contains("matched") ||
      button === this.firstCard
    ) {
      return;
    }

    this.sound.playFlip();
    button.classList.add("flipped");

    if (!this.firstCard) {
      this.firstCard = button;
      return;
    }

    this.secondCard = button;
    this.inputLocked = true;

    const isMatch = this.firstCard.dataset.pair === this.secondCard.dataset.pair;

    if (isMatch) {
      this.commitMatch();
    } else {
      this.commitMismatch();
    }
  }

  commitMatch() {
    this.sound.playMatch();
    this.firstCard.classList.add("matched");
    this.secondCard.classList.add("matched");

    this.streak += 1;
    this.matchedPairs += 1;
    this.stats.totalMatches += 1;

    const { matchBase, streakBonus, streakThreshold } = this.levelRules;
    let timeReward = matchBase;

    if (streakBonus > 0 && this.streak >= streakThreshold) {
      timeReward = streakBonus;
    }

    if (streakBonus > 0 && this.streak === streakThreshold) {
      this.showLevelToast(`2X STREAK ACTIVE · MATCH BONUS +${streakBonus}s`, {
        durationMs: 4000,
        allowShortDuration: true
      });
    }

    this.addTime(timeReward);

    const elapsedLevelSeconds = (performance.now() - this.levelStartTime) / 1000;
    const gain = this.calculateScoreGain({
      rows: this.boardRows,
      cols: this.boardCols,
      secondsUsed: elapsedLevelSeconds,
      streak: this.streak
    });

    this.score += gain;
    this.stats.score = this.score;

    this.resetPairSelection();
    this.updateHud();
    this.updateProgress();

    if (this.matchedPairs === this.totalPairs) {
      this.onLevelComplete();
    }
  }

  commitMismatch() {
    this.stats.totalMismatches += 1;
    this.streak = 0;

    if (this.levelRules.mismatchPenalty > 0) {
      this.deductTime(this.levelRules.mismatchPenalty);
    }

    setTimeout(() => {
      if (!this.firstCard || !this.secondCard) return;
      this.firstCard.classList.remove("flipped");
      this.secondCard.classList.remove("flipped");
      this.resetPairSelection();
      this.updateHud();
    }, 600);
  }

  calculateScoreGain({ rows, cols, secondsUsed, streak }) {
    const basePoints = 100;
    const difficultyMultiplier = (rows + cols) / 2;
    const timeBonus = Math.max(0, this.getLevelTimerSeconds(this.level) - secondsUsed);
    const streakBonus = streak * 20;
    return Math.floor(basePoints * difficultyMultiplier + timeBonus + streakBonus);
  }

  getLevelTimerSeconds(level) {
    if (level >= 6) {
      return 90;
    }
    if (level === 5) {
      return 75;
    }
    return 60;
  }

  getTimeRules(level) {
    if (level <= 3) {
      return {
        matchBase: 3,
        mismatchPenalty: 0,
        streakBonus: 0,
        streakThreshold: Number.POSITIVE_INFINITY
      };
    }

    if (level === 4) {
      return {
        matchBase: 2,
        mismatchPenalty: 0,
        streakBonus: 5,
        streakThreshold: 2
      };
    }

    if (level === 5) {
      return {
        matchBase: 2,
        mismatchPenalty: 1,
        streakBonus: 5,
        streakThreshold: 2
      };
    }

    // Difficulty tiers after level 6 keep pressure rising with stronger penalties.
    const tier = Math.floor((level - 6) / 2);
    return {
      matchBase: Math.max(1, 2 - tier),
      mismatchPenalty: 1 + tier,
      streakBonus: Math.max(3, 5 - tier),
      streakThreshold: 2
    };
  }

  getLevelRuleNotice(level, rules) {
    if (level === 4) {
      return "MATCH +2s | 2X STREAK = +5s";
    }

    if (level >= 5) {
      return `MATCH +${rules.matchBase}s | MISS -${rules.mismatchPenalty}s | 2X STREAK = +${rules.streakBonus}s`;
    }

    return "";
  }

  resetPairSelection() {
    this.firstCard = null;
    this.secondCard = null;
    this.inputLocked = false;
  }

  onLevelComplete() {
    const levelElapsed = ((performance.now() - this.levelStartTime) / 1000).toFixed(2);
    const completedLevel = this.level;
    const nextLevel = completedLevel + 1;

    this.stats.levels.push({
      level: completedLevel,
      boardRows: this.boardRows,
      boardCols: this.boardCols,
      completionSeconds: Number(levelElapsed),
      scoreAfterLevel: this.score,
      matchedPairs: this.totalPairs
    });

    const levelClearPauseMs = 1000;
    this.showLevelToast(`LEVEL ${completedLevel} CLEARED`, {
      durationMs: levelClearPauseMs,
      allowShortDuration: true
    });
    this.ui.board.classList.add("level-complete");
    this.inputLocked = true;

    setTimeout(() => {
      this.ui.board.classList.remove("level-complete");

      if (this.gameEnded) {
        return;
      }

      this.level = nextLevel;
      this.loadLevel();
    }, levelClearPauseMs);
  }

  showLevelToast(text, { durationMs = 5000, pauseGame = true, allowShortDuration = false } = {}) {
    const minimumDuration = allowShortDuration ? 0 : 5000;
    const displayDuration = Math.max(minimumDuration, durationMs);

    if (this.toastTimeoutId) {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    const shouldRestoreInput = !this.inputLocked;
    if (pauseGame) {
      this.inputLocked = true;
      this.pauseTimerFor(displayDuration);
    }

    this.ui.levelToast.textContent = text;
    this.ui.levelToast.classList.remove("show");
    void this.ui.levelToast.offsetWidth;
    this.ui.levelToast.classList.add("show");

    this.toastTimeoutId = window.setTimeout(() => {
      this.ui.levelToast.classList.remove("show");
      this.toastTimeoutId = null;

      if (pauseGame && shouldRestoreInput && !this.gameEnded) {
        this.inputLocked = false;
      }
    }, displayDuration);
  }

  updateProgress() {
    const ratio = this.totalPairs === 0 ? 0 : this.matchedPairs / this.totalPairs;
    this.ui.progressFill.style.width = `${(ratio * 100).toFixed(2)}%`;
    this.ui.progressText.textContent = `${this.matchedPairs} / ${this.totalPairs} pairs matched`;
  }

  updateHud() {
    this.ui.score.textContent = this.score.toLocaleString();
    this.ui.streak.textContent = `${this.streak}x`;
    this.ui.levelPill.textContent = `LEVEL ${this.level} · ${this.boardRows}x${this.boardCols}`;
    this.ui.timer.textContent = Math.max(0, this.remainingTimeSeconds).toFixed(1);
  }

  startTimer() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
    }

    this.lastTimerTick = performance.now();

    this.timerId = window.setInterval(() => {
      const now = performance.now();

      if (this.pauseUntilTimestamp > now) {
        this.lastTimerTick = now;
        this.updateHud();
        return;
      }

      const elapsedSeconds = (now - this.lastTimerTick) / 1000;
      this.lastTimerTick = now;
      this.remainingTimeSeconds -= elapsedSeconds;

      if (this.remainingTimeSeconds <= 0) {
        this.remainingTimeSeconds = 0;
        this.onTimeUp();
      }

      this.updateHud();
    }, 50);
  }

  pauseTimerFor(milliseconds) {
    const now = performance.now();
    this.pauseUntilTimestamp = Math.max(this.pauseUntilTimestamp, now + milliseconds);
    this.lastTimerTick = now;
  }

  addTime(seconds) {
    this.remainingTimeSeconds += seconds;
    this.updateHud();
  }

  deductTime(seconds) {
    this.remainingTimeSeconds = Math.max(0, this.remainingTimeSeconds - seconds);
    if (this.remainingTimeSeconds === 0) {
      this.onTimeUp();
    }
    this.updateHud();
  }

  onTimeUp() {
    if (this.gameEnded) {
      return;
    }

    this.gameEnded = true;
    this.inputLocked = true;
    this.showLevelToast("TIME UP · PRESS NEW GAME");

    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  exportLeaderboardEntry(playerName = "anonymous") {
    return {
      player: playerName,
      score: this.score,
      streak: this.streak,
      levelReached: this.level,
      finishedAt: new Date().toISOString(),
      session: this.stats
    };
  }
}

async function loadDataset() {
  try {
    const response = await fetch("./cards.json");
    if (!response.ok) {
      throw new Error("cards.json not available");
    }
    const data = await response.json();
    return Array.isArray(data) && data.length ? data : FALLBACK_DATASET;
  } catch {
    return FALLBACK_DATASET;
  }
}

(async () => {
  try {
    const dataset = await loadDataset();
    const game = new RitualProofOfMatch(dataset);
    game.startNewGame();

    // Exposed for optional leaderboard integration.
    window.ritualProofOfMatch = game;
  } catch (error) {
    const board = document.getElementById("gameBoard");
    if (board) {
      board.innerHTML = `<div style="padding:1rem;border:1px solid rgba(255,95,124,0.7);border-radius:10px;background:rgba(36,12,20,0.7);color:#ffd7df;">Game failed to start. Open DevTools console for details.</div>`;
    }
    // Keep console details for debugging runtime environment issues.
    console.error("Ritual: Proof of Match bootstrap failed", error);
  }
})();
