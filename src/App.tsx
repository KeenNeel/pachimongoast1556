/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Ghost, Skull, Candy, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const TILE_SIZE = 36; // Slightly smaller for mobile fit
const GRID_WIDTH = 15; // Vertical layout
const GRID_HEIGHT = 21; 
const CANVAS_WIDTH = TILE_SIZE * GRID_WIDTH;
const CANVAS_HEIGHT = TILE_SIZE * GRID_HEIGHT;

const COLORS = {
  wall: '#050505',
  pellet: '#ff9900',
  candy: ['#ff00ff', '#00ffff', '#ffff00', '#ff6600', '#ff0000', '#00ff00'],
  pacman: '#ff6600',
  ghosts: [
    { name: 'Vampire', color: '#ff0000', trait: 'cape' },
    { name: 'Witch', color: '#9933ff', trait: 'hat' },
    { name: 'Bat', color: '#444444', trait: 'wings' },
    { name: 'Zombie', color: '#00ff00', trait: 'stitches' }
  ],
  scaredGhost: '#ffffff',
};

const STAGE_COLORS = ['#ff6600', '#9933ff', '#00ff00', '#ff00ff'];

// Maze Generation Helper
const generateMaze = () => {
  const maze = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill(1));
  
  const walk = (x: number, y: number) => {
    maze[y][x] = 0;
    const dirs = [[0, 2], [0, -2], [2, 0], [-2, 0]].sort(() => Math.random() - 0.5);
    
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && nx < GRID_WIDTH - 1 && ny > 0 && ny < GRID_HEIGHT - 1 && maze[ny][nx] === 1) {
        maze[y + dy / 2][x + dx / 2] = 0;
        walk(nx, ny);
      }
    }
  };

  walk(1, 1);
  
  // Add ghost house in center
  const midX = Math.floor(GRID_WIDTH / 2);
  const midY = Math.floor(GRID_HEIGHT / 2);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      maze[midY + i][midX + j] = 0;
    }
  }
  maze[midY][midX] = 4; // Ghost spawn

  // Fill with pellets
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (maze[y][x] === 0) maze[y][x] = 2;
    }
  }
  
  // Pacman start
  maze[GRID_HEIGHT - 2][midX] = 5;
  
  return maze;
};

const SOUND_URLS = {
  CHOMP: 'https://raw.githubusercontent.com/yashshah/Pacman/master/sounds/pacman_chomp.wav',
  GHOST_EATEN: 'https://raw.githubusercontent.com/yashshah/Pacman/master/sounds/pacman_eatghost.wav',
  DEATH: 'https://raw.githubusercontent.com/yashshah/Pacman/master/sounds/pacman_death.wav',
  POWER_UP: 'https://raw.githubusercontent.com/yashshah/Pacman/master/sounds/pacman_eatfruit.wav',
  WIN: 'https://raw.githubusercontent.com/yashshah/Pacman/master/sounds/pacman_intermission.wav',
};

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'NONE';

interface Entity {
  x: number;
  y: number;
  dir: Direction;
  nextDir: Direction;
  speed: number;
}

interface GhostEntity extends Entity {
  color: string;
  trait: string;
  isScared: boolean;
  isEaten: boolean;
  isDying: boolean;
  deathTimer: number;
}

interface ScorePopup {
  x: number;
  y: number;
  score: number;
  timer: number;
}

interface WallFragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  timer: number;
  color: string;
}

interface WitchEntity {
  x: number;
  y: number;
  speed: number;
  active: boolean;
  phase: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAMEOVER' | 'WON' | 'COUNTDOWN'>('START');
  const [isMuted, setIsMuted] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [popups, setPopups] = useState<ScorePopup[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [consumptionRate, setConsumptionRate] = useState(0);
  const [wallsLeft, setWallsLeft] = useState(0);
  const wallsLeftRef = useRef(0);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const [stage, setStage] = useState(1);
  const stageRef = useRef(1);
  const witchesRef = useRef<WitchEntity[]>([]);

  // Audio Context for Synthesized Sounds
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bgMusicRef = useRef<{ oscillators: OscillatorNode[]; gainNodes: GainNode[] } | null>(null);
  const melodyIntervalRef = useRef<number | null>(null);
  const moanIntervalRef = useRef<number | null>(null);
  const wallFragmentsRef = useRef<WallFragment[]>([]);

  const initAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const playSynthSound = useCallback((type: 'CHOMP' | 'GHOST_EATEN' | 'DEATH' | 'POWER_UP' | 'WIN' | 'WALL_BREAK' | 'MOAN') => {
    if (isMuted) return;
    initAudioContext();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    switch (type) {
      case 'CHOMP':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
        gain.gain.setValueAtTime(0.4, now); // Even stronger
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      case 'GHOST_EATEN':
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.4); // Stronger and longer
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
      case 'DEATH':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 1.2); // Longer and deeper
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.2);
        osc.start(now);
        osc.stop(now + 1.2);
        break;
      case 'POWER_UP':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(1800, now + 0.5); // Stronger
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      case 'WIN':
        osc.type = 'square';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.15);
        osc.frequency.setValueAtTime(783.99, now + 0.3);
        osc.frequency.setValueAtTime(1046.50, now + 0.45);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
        break;
      case 'WALL_BREAK':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(20, now + 0.3);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      case 'MOAN':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(100 + Math.random() * 50, now);
        osc.frequency.exponentialRampToValueAtTime(200 + Math.random() * 100, now + 1.0);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.5);
        gain.gain.linearRampToValueAtTime(0, now + 1.0);
        osc.start(now);
        osc.stop(now + 1.0);
        break;
    }
  }, [isMuted, initAudioContext]);

  const stopBgMusic = useCallback(() => {
    if (bgMusicRef.current) {
      const { oscillators, gainNodes } = bgMusicRef.current;
      const now = audioCtxRef.current?.currentTime || 0;
      gainNodes.forEach(g => {
        g.gain.cancelScheduledValues(now);
        g.gain.linearRampToValueAtTime(0, now + 0.5);
      });
      setTimeout(() => {
        oscillators.forEach(o => {
          try { o.stop(); } catch (e) {}
        });
      }, 500);
      bgMusicRef.current = null;
    }
    if (melodyIntervalRef.current) {
      window.clearInterval(melodyIntervalRef.current);
      melodyIntervalRef.current = null;
    }
    if (moanIntervalRef.current) {
      window.clearInterval(moanIntervalRef.current);
      moanIntervalRef.current = null;
    }
  }, []);

  const playMelodyNote = useCallback((freq: number, duration: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx || isMuted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.2); // Lower volume, longer fade in
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }, [isMuted]);

  const startBgMusic = useCallback(() => {
    if (isMuted) return;
    initAudioContext();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (bgMusicRef.current) return;

    const oscillators: OscillatorNode[] = [];
    const gainNodes: GainNode[] = [];

    // Create a low spooky drone
    const createDrone = (freq: number, volume: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 4); // Longer fade in
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      oscillators.push(osc);
      gainNodes.push(g);
    };

    createDrone(55, 0.005); // A1 - Much quieter
    createDrone(56, 0.003); // Slightly detuned
    createDrone(110, 0.002); // A2

    bgMusicRef.current = { oscillators, gainNodes };

    // More ominous, slower melody loop
    const melody = [220, 0, 233.08, 0, 220, 0, 196, 0, 220, 0, 261.63, 0, 246.94, 0, 220, 0]; 
    const bass = [55, 55, 51.91, 55, 61.74, 55, 58.27, 55]; 
    let noteIdx = 0;
    melodyIntervalRef.current = window.setInterval(() => {
      if (melody[noteIdx % melody.length] > 0) {
        playMelodyNote(melody[noteIdx % melody.length], 2.0); // Longer notes
        playMelodyNote(bass[noteIdx % bass.length], 2.0); 
        if (noteIdx % 8 === 0) playSynthSound('MOAN');
      }
      noteIdx++;
    }, 800); // Much slower

    // Ghost moans
    moanIntervalRef.current = window.setInterval(() => {
      if (Math.random() < 0.2) playSynthSound('MOAN');
    }, 5000);
  }, [isMuted, initAudioContext, playMelodyNote, playSynthSound]);

  const startIntroMusic = useCallback(() => {
    if (isMuted) return;
    initAudioContext();
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== 'running') return;

    if (bgMusicRef.current) return;

    const oscillators: OscillatorNode[] = [];
    const gainNodes: GainNode[] = [];

    const createDrone = (freq: number, volume: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 4);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      oscillators.push(osc);
      gainNodes.push(g);
    };

    createDrone(40, 0.01);
    createDrone(41, 0.01);
    createDrone(80, 0.005);

    bgMusicRef.current = { oscillators, gainNodes };

    // Intro melody: more complex ominous sequence
    const melody = [220, 233.08, 220, 207.65, 220, 261.63, 246.94, 220]; 
    let noteIdx = 0;
    melodyIntervalRef.current = window.setInterval(() => {
      playMelodyNote(melody[noteIdx % melody.length], 0.8);
      noteIdx++;
    }, 800);
  }, [isMuted, initAudioContext, playMelodyNote]);

  useEffect(() => {
    if (isMuted) {
      stopBgMusic();
    } else if (gameState === 'START') {
      startIntroMusic();
    } else if (gameState === 'PLAYING') {
      stopBgMusic();
      startBgMusic();
    } else {
      stopBgMusic();
    }
    return () => stopBgMusic();
  }, [isMuted, gameState, startBgMusic, startIntroMusic, stopBgMusic]);

  // Game State Refs (for the loop)
  const pacmanRef = useRef<Entity>({ x: 9 * TILE_SIZE, y: 15 * TILE_SIZE, dir: 'NONE', nextDir: 'NONE', speed: 2 });
  const ghostsRef = useRef<GhostEntity[]>([]);
  const mazeRef = useRef<number[][]>([]);
  const powerModeRef = useRef(0); // Timer for power pellets
  const totalPelletsRef = useRef(0);
  const eatenPelletsRef = useRef(0);
  const frameCountRef = useRef(0);

  const initGame = useCallback((isNextStage = false) => {
    if (isNextStage) {
      setStage(s => {
        const next = s + 1;
        stageRef.current = next;
        return next;
      });
    } else {
      setStage(1);
      stageRef.current = 1;
      setScore(0);
      setLives(3);
    }

    const newMaze = generateMaze();
    mazeRef.current = newMaze;
    witchesRef.current = [];
    
    // Count total pellets
    let total = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (newMaze[y][x] === 2 || newMaze[y][x] === 3) total++;
      }
    }
    totalPelletsRef.current = total;
    eatenPelletsRef.current = 0;
    
    // Find pacman start
    let px = Math.floor(GRID_WIDTH / 2);
    let py = GRID_HEIGHT - 2;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (newMaze[y][x] === 5) { px = x; py = y; newMaze[y][x] = 0; }
      }
    }

    pacmanRef.current = { x: px * TILE_SIZE, y: py * TILE_SIZE, dir: 'NONE', nextDir: 'NONE', speed: 4 };
    
    const midX = Math.floor(GRID_WIDTH / 2);
    const midY = Math.floor(GRID_HEIGHT / 2);

    ghostsRef.current = COLORS.ghosts.map((g, i) => ({
      x: (midX + (i % 2 === 0 ? -1 : 1)) * TILE_SIZE,
      y: midY * TILE_SIZE,
      dir: 'UP',
      nextDir: 'UP',
      speed: 2,
      color: g.color,
      trait: g.trait,
      isScared: false,
      isEaten: false,
      isDying: false,
      deathTimer: 0,
    }));

    // Place 10 random candy power pellets
    let placed = 0;
    while (placed < 10) {
      const rx = Math.floor(Math.random() * GRID_WIDTH);
      const ry = Math.floor(Math.random() * GRID_HEIGHT);
      if (mazeRef.current[ry][rx] === 2) {
        mazeRef.current[ry][rx] = 3;
        placed++;
      }
    }

    // Place 3 random tombstones
    let tombstones = 0;
    while (tombstones < 3) {
      const rx = Math.floor(Math.random() * GRID_WIDTH);
      const ry = Math.floor(Math.random() * GRID_HEIGHT);
      if (mazeRef.current[ry][rx] === 2 || mazeRef.current[ry][rx] === 0) {
        mazeRef.current[ry][rx] = 6; // Tombstone
        tombstones++;
      }
    }

    setPopups([]);
    setConsumptionRate(0);
    setWallsLeft(0);
    wallsLeftRef.current = 0;
    powerModeRef.current = 0;
  }, []);

  const resetPositions = useCallback(() => {
    const midX = Math.floor(GRID_WIDTH / 2);
    const midY = Math.floor(GRID_HEIGHT / 2);
    pacmanRef.current = { x: midX * TILE_SIZE, y: (GRID_HEIGHT - 2) * TILE_SIZE, dir: 'NONE', nextDir: 'NONE', speed: 4 };
    ghostsRef.current.forEach((ghost, i) => {
      ghost.x = (midX + (i % 2 === 0 ? -1 : 1)) * TILE_SIZE;
      ghost.y = midY * TILE_SIZE;
      ghost.dir = 'UP';
      ghost.isScared = false;
      ghost.isEaten = false;
      ghost.isDying = false;
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setGameState('GAMEOVER');
      stopBgMusic();
      return;
    }
    switch (e.key) {
      case 'ArrowUp': pacmanRef.current.nextDir = 'UP'; break;
      case 'ArrowDown': pacmanRef.current.nextDir = 'DOWN'; break;
      case 'ArrowLeft': pacmanRef.current.nextDir = 'LEFT'; break;
      case 'ArrowRight': pacmanRef.current.nextDir = 'RIGHT'; break;
    }
  }, [stopBgMusic]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const canMove = (x: number, y: number, dir: Direction) => {
    let nextX = x;
    let nextY = y;
    const buffer = 4; // Buffer

    if (dir === 'UP') nextY -= buffer;
    if (dir === 'DOWN') nextY += TILE_SIZE + buffer - 1;
    if (dir === 'LEFT') nextX -= buffer;
    if (dir === 'RIGHT') nextX += TILE_SIZE + buffer - 1;

    const gridX = Math.floor(nextX / TILE_SIZE);
    const gridY = Math.floor(nextY / TILE_SIZE);

    // Wrap around
    if (gridX < 0 || gridX >= GRID_WIDTH) return true;
    if (gridY < 0 || gridY >= GRID_HEIGHT) return false;

    const cell = mazeRef.current[gridY]?.[gridX];
    if (cell === 1) {
      // If powered up and has break charges, can break walls
      return powerModeRef.current > 0 && wallsLeftRef.current > 0;
    }

    return cell !== 1;
  };

  const update = () => {
    if (gameState !== 'PLAYING') return;

    const pacman = pacmanRef.current;
    
    // Snapping to grid for cleaner direction changes
    const isAtIntersection = pacman.x % TILE_SIZE === 0 && pacman.y % TILE_SIZE === 0;

    if (pacman.nextDir !== 'NONE' && isAtIntersection) {
      if (canMove(pacman.x, pacman.y, pacman.nextDir)) {
        pacman.dir = pacman.nextDir;
        pacman.nextDir = 'NONE';
      }
    }

    // Move Pacman
    if (canMove(pacman.x, pacman.y, pacman.dir)) {
      if (pacman.dir === 'UP') pacman.y -= pacman.speed;
      if (pacman.dir === 'DOWN') pacman.y += pacman.speed;
      if (pacman.dir === 'LEFT') pacman.x -= pacman.speed;
      if (pacman.dir === 'RIGHT') pacman.x += pacman.speed;

      // Break walls if in power mode and has charges
      if (powerModeRef.current > 0 && wallsLeftRef.current > 0) {
        const gridX = Math.floor((pacman.x + TILE_SIZE / 2) / TILE_SIZE);
        const gridY = Math.floor((pacman.y + TILE_SIZE / 2) / TILE_SIZE);
        if (mazeRef.current[gridY]?.[gridX] === 1) {
          mazeRef.current[gridY][gridX] = 0;
          wallsLeftRef.current--;
          setWallsLeft(wallsLeftRef.current);
          playSynthSound('WALL_BREAK');
          setScore(s => s + 50);
          
          const wallColor = STAGE_COLORS[(stageRef.current - 1) % STAGE_COLORS.length];
          // Wall shattering effect
          for (let i = 0; i < 8; i++) {
            wallFragmentsRef.current.push({
              x: gridX * TILE_SIZE + TILE_SIZE / 2,
              y: gridY * TILE_SIZE + TILE_SIZE / 2,
              vx: (Math.random() - 0.5) * 10,
              vy: (Math.random() - 0.5) * 10,
              timer: 30,
              color: wallColor
            });
          }
        }
      }
    } else if (!isAtIntersection) {
      // If not at intersection but can't move, snap to nearest tile to prevent sticking
      pacman.x = Math.round(pacman.x / TILE_SIZE) * TILE_SIZE;
      pacman.y = Math.round(pacman.y / TILE_SIZE) * TILE_SIZE;
    }

    // Wrap around logic
    if (pacman.x < -TILE_SIZE) pacman.x = CANVAS_WIDTH;
    if (pacman.x > CANVAS_WIDTH) pacman.x = -TILE_SIZE;

    // Stuck detection / Out of bounds
    if (pacman.x < -TILE_SIZE * 2 || pacman.x > CANVAS_WIDTH + TILE_SIZE * 2 || 
        pacman.y < -TILE_SIZE * 2 || pacman.y > CANVAS_HEIGHT + TILE_SIZE * 2) {
      resetPositions();
    }

    // Grid collision (pellets)
    const gridX = Math.round(pacman.x / TILE_SIZE);
    const gridY = Math.round(pacman.y / TILE_SIZE);
    const cell = mazeRef.current[gridY]?.[gridX];

    if (cell === 2) {
      mazeRef.current[gridY][gridX] = 0;
      eatenPelletsRef.current++;
      setConsumptionRate(Math.floor((eatenPelletsRef.current / totalPelletsRef.current) * 100));
      setScore(s => s + 10);
      playSynthSound('CHOMP');
    } else if (cell === 3) {
      mazeRef.current[gridY][gridX] = 0;
      eatenPelletsRef.current++;
      setConsumptionRate(Math.floor((eatenPelletsRef.current / totalPelletsRef.current) * 100));
      setScore(s => s + 50);
      playSynthSound('POWER_UP');
      powerModeRef.current = 600; // ~10 seconds at 60fps
      wallsLeftRef.current = 5; // 5 wall break charges
      setWallsLeft(5);
      ghostsRef.current.forEach(g => { if (!g.isEaten) g.isScared = true; });
      
      // Respawn another power pellet
      let respawned = false;
      let attempts = 0;
      while (!respawned && attempts < 100) {
        const rx = Math.floor(Math.random() * GRID_WIDTH);
        const ry = Math.floor(Math.random() * GRID_HEIGHT);
        if (mazeRef.current[ry][rx] === 2 || mazeRef.current[ry][rx] === 0) {
          mazeRef.current[ry][rx] = 3;
          respawned = true;
        }
        attempts++;
      }
    } else if (cell === 6) {
      // Tombstone collision
      if (powerModeRef.current === 0) {
        setLives(l => {
          playSynthSound('DEATH');
          if (l <= 1) {
            setGameState('GAMEOVER');
            return 0;
          }
          resetPositions();
          return l - 1;
        });
        // Remove tombstone after hit? Usually yes in Pacman clones to avoid double hit
        mazeRef.current[gridY][gridX] = 0;
      } else {
        // Break tombstone in invincible mode
        mazeRef.current[gridY][gridX] = 0;
        if (wallsLeftRef.current > 0) {
          wallsLeftRef.current--;
          setWallsLeft(wallsLeftRef.current);
        }
        playSynthSound('WALL_BREAK');
        setScore(s => s + 100);
      }
    } else if (cell === 7) {
      // Fruit collision
      mazeRef.current[gridY][gridX] = 0;
      setScore(s => s + 500);
      playSynthSound('POWER_UP');
      setPopups(prev => [...prev, { x: pacman.x, y: pacman.y, score: 500, timer: 60 }]);
    }

    // Update Power Mode
    if (powerModeRef.current > 0) {
      powerModeRef.current--;
      if (powerModeRef.current === 0) {
        ghostsRef.current.forEach(g => g.isScared = false);
      }
    }

    // Update Popups
    setPopups(prev => prev.map(p => ({ ...p, timer: p.timer - 1 })).filter(p => p.timer > 0));

    // Update Wall Fragments
    wallFragmentsRef.current = wallFragmentsRef.current.map(f => ({
      ...f,
      x: f.x + f.vx,
      y: f.y + f.vy,
      timer: f.timer - 1
    })).filter(f => f.timer > 0);

    // Update Ghosts
    ghostsRef.current.forEach(ghost => {
      if (ghost.isDying) {
        ghost.deathTimer--;
        ghost.y -= 2; // Ascend
        if (ghost.deathTimer <= 0) {
          ghost.isDying = false;
          ghost.isEaten = true;
          ghost.x = Math.floor(GRID_WIDTH / 2) * TILE_SIZE;
          ghost.y = Math.floor(GRID_HEIGHT / 2) * TILE_SIZE;
        }
        return;
      }

      // Simple AI: Random movement at intersections
      if (ghost.x % TILE_SIZE === 0 && ghost.y % TILE_SIZE === 0) {
        const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        const validDirs = dirs.filter(d => {
          if (d === 'UP' && ghost.dir === 'DOWN') return false;
          if (d === 'DOWN' && ghost.dir === 'UP') return false;
          if (d === 'LEFT' && ghost.dir === 'RIGHT') return false;
          if (d === 'RIGHT' && ghost.dir === 'LEFT') return false;
          return canMove(ghost.x, ghost.y, d);
        });

        if (validDirs.length > 0) {
          ghost.dir = validDirs[Math.floor(Math.random() * validDirs.length)];
        } else {
          const anyValid = (['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[]).filter(d => canMove(ghost.x, ghost.y, d));
          ghost.dir = anyValid[0] || 'NONE';
        }
      }

      const speed = ghost.isScared ? ghost.speed * 0.5 : ghost.speed;
      if (ghost.dir === 'UP') ghost.y -= speed;
      if (ghost.dir === 'DOWN') ghost.y += speed;
      if (ghost.dir === 'LEFT') ghost.x -= speed;
      if (ghost.dir === 'RIGHT') ghost.x += speed;

      // Wrap around
      if (ghost.x < -TILE_SIZE) ghost.x = CANVAS_WIDTH;
      if (ghost.x > CANVAS_WIDTH) ghost.x = -TILE_SIZE;

      // Collision with Pacman
      const dist = Math.sqrt(Math.pow(pacman.x - ghost.x, 2) + Math.pow(pacman.y - ghost.y, 2));
      if (dist < TILE_SIZE * 0.8 && !ghost.isEaten && !ghost.isDying) {
        if (ghost.isScared) {
          ghost.isScared = false;
          ghost.isDying = true;
          ghost.deathTimer = 30;
          setScore(s => s + 200);
          setPopups(prev => [...prev, { x: ghost.x, y: ghost.y, score: 200, timer: 60 }]);
          playSynthSound('GHOST_EATEN');
        } else {
          setLives(l => {
            playSynthSound('DEATH');
            if (l <= 1) {
              setGameState('GAMEOVER');
              return 0;
            }
            resetPositions();
            return l - 1;
          });
        }
      }

      // Respawn eaten ghosts
      if (ghost.isEaten && Math.random() < 0.005) {
        ghost.isEaten = false;
      }
    });

    // Check Win (75% of pellets)
    const winThreshold = 0.75;
    if (eatenPelletsRef.current / totalPelletsRef.current >= winThreshold && gameState === 'PLAYING') {
      playSynthSound('WIN');
      setGameState('WON');
      
      // Start countdown to next stage after 2 seconds
      setTimeout(() => {
        setGameState('COUNTDOWN');
        setCountdown(3);
        const interval = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              nextStage();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }, 2000);
    }

    // Random Candy Bonus Spawn
    if (Math.random() < 0.001) {
      const rx = Math.floor(Math.random() * GRID_WIDTH);
      const ry = Math.floor(Math.random() * GRID_HEIGHT);
      if (mazeRef.current[ry][rx] === 0) {
        mazeRef.current[ry][rx] = 3; // Use power pellet as candy bonus for now
      }
    }

    // Random Fruit Bonus Spawn
    if (Math.random() < 0.0005) {
      const rx = Math.floor(Math.random() * GRID_WIDTH);
      const ry = Math.floor(Math.random() * GRID_HEIGHT);
      if (mazeRef.current[ry][rx] === 0) {
        mazeRef.current[ry][rx] = 7; // Fruit
      }
    }

    // Random Witch Spawn
    if (Math.random() < 0.005 && witchesRef.current.length < 2) {
      witchesRef.current.push({
        x: Math.random() * CANVAS_WIDTH,
        y: -50,
        speed: 2 + Math.random() * 2,
        active: true,
        phase: Math.random() * Math.PI * 2
      });
    }

    // Update Witches
    witchesRef.current.forEach(witch => {
      witch.y += witch.speed;
      witch.x += Math.sin(witch.y / 30 + witch.phase) * 3;
      
      const dist = Math.sqrt(Math.pow(pacman.x - witch.x, 2) + Math.pow(pacman.y - witch.y, 2));
      if (dist < TILE_SIZE * 0.7 && witch.active) {
        witch.active = false;
        setLives(l => {
          playSynthSound('DEATH');
          if (l <= 1) {
            setGameState('GAMEOVER');
            return 0;
          }
          resetPositions();
          return l - 1;
        });
      }
    });
    witchesRef.current = witchesRef.current.filter(w => w.y < CANVAS_HEIGHT + 50 && w.active);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Maze
    const wallColor = STAGE_COLORS[(stageRef.current - 1) % STAGE_COLORS.length];
    mazeRef.current.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell === 1) {
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          
          // Glowing border
          ctx.strokeStyle = wallColor;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 15;
          ctx.shadowColor = wallColor;
          
          // Only draw borders where there's no adjacent wall
          if (mazeRef.current[y-1]?.[x] !== 1) {
            ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, y * TILE_SIZE); ctx.lineTo((x+1) * TILE_SIZE, y * TILE_SIZE); ctx.stroke();
          }
          if (mazeRef.current[y+1]?.[x] !== 1) {
            ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, (y+1) * TILE_SIZE); ctx.lineTo((x+1) * TILE_SIZE, (y+1) * TILE_SIZE); ctx.stroke();
          }
          if (mazeRef.current[y]?.[x-1] !== 1) {
            ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, y * TILE_SIZE); ctx.lineTo(x * TILE_SIZE, (y+1) * TILE_SIZE); ctx.stroke();
          }
          if (mazeRef.current[y]?.[x+1] !== 1) {
            ctx.beginPath(); ctx.moveTo((x+1) * TILE_SIZE, y * TILE_SIZE); ctx.lineTo((x+1) * TILE_SIZE, (y+1) * TILE_SIZE); ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (cell === 2) {
          ctx.fillStyle = COLORS.pellet;
          ctx.beginPath();
          ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (cell === 3) {
          // Draw Swaying Candy
          const swayX = Math.sin(Date.now() / 200 + x) * 4;
          const swayY = Math.cos(Date.now() / 200 + y) * 4;
          const pulse = Math.sin(Date.now() / 150) * 3 + 10;
          const candyColor = COLORS.candy[(x + y) % COLORS.candy.length];
          
          ctx.save();
          ctx.translate(x * TILE_SIZE + TILE_SIZE / 2 + swayX, y * TILE_SIZE + TILE_SIZE / 2 + swayY);
          ctx.fillStyle = candyColor;
          ctx.shadowBlur = 20;
          ctx.shadowColor = candyColor;
          
          // Wrapped candy shape
          ctx.beginPath();
          ctx.ellipse(0, 0, pulse, pulse / 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
          
          // Wrappers
          ctx.beginPath();
          ctx.moveTo(-pulse, 0); ctx.lineTo(-pulse - 6, -6); ctx.lineTo(-pulse - 6, 6); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(pulse, 0); ctx.lineTo(pulse + 6, -6); ctx.lineTo(pulse + 6, 6); ctx.fill();
          
          ctx.restore();
        } else if (cell === 6) {
          // Draw Tombstone
          ctx.save();
          ctx.translate(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
          ctx.fillStyle = '#666';
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fff';
          
          ctx.beginPath();
          ctx.moveTo(-12, 16);
          ctx.lineTo(-12, -8);
          ctx.arc(0, -8, 12, Math.PI, 0);
          ctx.lineTo(12, 16);
          ctx.closePath();
          ctx.fill();
          
          ctx.fillStyle = '#000';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('RIP', 0, 0);
          
          ctx.restore();
        } else if (cell === 7) {
          // Draw Glowing Fruit
          ctx.save();
          ctx.translate(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
          const pulse = Math.sin(Date.now() / 100) * 5 + 15;
          ctx.fillStyle = '#fff';
          ctx.shadowBlur = 25;
          ctx.shadowColor = '#fff';
          
          // Fruit shape (simple cherry/apple)
          ctx.beginPath();
          ctx.arc(0, 0, pulse / 2, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.restore();
        }
      });
    });

    // Draw Wall Fragments
    wallFragmentsRef.current.forEach(f => {
      ctx.fillStyle = f.color;
      ctx.globalAlpha = f.timer / 30;
      ctx.fillRect(f.x, f.y, 4, 4);
    });
    ctx.globalAlpha = 1.0;

    // Draw Pacman (Jack-o'-lantern)
    const pacman = pacmanRef.current;
    ctx.save();
    ctx.translate(pacman.x + TILE_SIZE / 2, pacman.y + TILE_SIZE / 2);
    
    // Neon Glow
    const isPowered = powerModeRef.current > 0;
    const pulseScale = isPowered ? 1 + Math.sin(Date.now() / 100) * 0.2 : 1;
    ctx.scale(pulseScale, pulseScale);
    
    ctx.shadowBlur = isPowered ? 30 : 20;
    ctx.shadowColor = isPowered ? '#ff0000' : COLORS.pacman;

    // Rotate based on direction
    if (pacman.dir === 'DOWN') ctx.rotate(Math.PI / 2);
    if (pacman.dir === 'LEFT') ctx.rotate(Math.PI);
    if (pacman.dir === 'UP') ctx.rotate(-Math.PI / 2);

    // Pumpkin body
    ctx.fillStyle = isPowered ? '#ff0000' : COLORS.pacman;
    ctx.beginPath();
    const mouthOpen = Math.sin(Date.now() / 100) * 0.2 + 0.2;
    ctx.arc(0, 0, TILE_SIZE / 2 - 2, mouthOpen, Math.PI * 2 - mouthOpen);
    ctx.lineTo(0, 0);
    ctx.fill();

    // Pumpkin face (eyes)
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(2, -4);
    ctx.lineTo(6, -2);
    ctx.lineTo(2, 0);
    ctx.fill();
    
    ctx.restore();
    ctx.shadowBlur = 0;

    // Draw Ghosts
    ghostsRef.current.forEach(ghost => {
      if (ghost.isEaten) return;

      ctx.save();
      ctx.translate(ghost.x + TILE_SIZE / 2, ghost.y + TILE_SIZE / 2);

      // Neon Glow
      ctx.shadowBlur = 20;
      ctx.shadowColor = ghost.isScared ? COLORS.scaredGhost : ghost.color;

      // Anxious shaking for scared ghosts
      let shakeX = 0;
      let shakeY = 0;
      if (ghost.isScared) {
        shakeX = (Math.random() - 0.5) * 4;
        shakeY = (Math.random() - 0.5) * 4;
      }
      ctx.translate(shakeX, shakeY);

      if (ghost.isDying) {
        const scale = ghost.deathTimer / 30;
        ctx.scale(scale, scale);
        ctx.globalAlpha = scale;
        ctx.fillStyle = '#ffffff'; // Turn into white spirit
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 30;
      } else {
        ctx.fillStyle = ghost.isScared ? COLORS.scaredGhost : ghost.color;
      }
      ctx.beginPath();
      ctx.arc(0, -2, TILE_SIZE / 2 - 4, Math.PI, 0);
      ctx.lineTo(TILE_SIZE / 2 - 4, TILE_SIZE / 2 - 4);
      
      // Wavy bottom
      for (let i = 0; i < 3; i++) {
        const x = (TILE_SIZE / 2 - 4) - (i * (TILE_SIZE - 8) / 2);
        const wave = Math.sin(Date.now() / 100 + i) * 2;
        ctx.lineTo(x, TILE_SIZE / 2 - 4 + wave);
      }
      
      ctx.lineTo(-(TILE_SIZE / 2 - 4), TILE_SIZE / 2 - 4);
      ctx.fill();

      // Halloween Traits
      if (!ghost.isScared) {
        ctx.fillStyle = '#000';
        if (ghost.trait === 'hat') {
          ctx.beginPath();
          ctx.moveTo(-10, -12); ctx.lineTo(10, -12); ctx.lineTo(0, -24); ctx.fill();
        } else if (ghost.trait === 'cape') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(-12, -4, 24, 12);
        } else if (ghost.trait === 'wings') {
          ctx.beginPath();
          ctx.moveTo(-12, -8); ctx.lineTo(-20, -12); ctx.lineTo(-12, -4);
          ctx.moveTo(12, -8); ctx.lineTo(20, -12); ctx.lineTo(12, -4);
          ctx.stroke();
        } else if (ghost.trait === 'stitches') {
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(8, 4); ctx.stroke();
          for(let i=-6; i<=6; i+=4) { ctx.moveTo(i, 2); ctx.lineTo(i, 6); ctx.stroke(); }
        }
      }

      // Eyes
      ctx.fillStyle = ghost.isScared ? '#000' : '#fff';
      ctx.beginPath();
      ctx.arc(-4, -4, 3, 0, Math.PI * 2);
      ctx.arc(4, -4, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });

    // Draw Witches
    witchesRef.current.forEach(witch => {
      ctx.save();
      ctx.translate(witch.x, witch.y);
      
      // Witch Silhouette/Icon
      ctx.fillStyle = '#9933ff';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#fff';
      
      // Hat
      ctx.beginPath();
      ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.lineTo(0, -25); ctx.fill();
      // Face
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      ctx.arc(0, 5, 8, 0, Math.PI * 2); ctx.fill();
      // Broom
      ctx.strokeStyle = '#663300'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-20, 10); ctx.lineTo(20, 5); ctx.stroke();
      
      ctx.restore();
    });

    // Draw Popups
    popups.forEach(p => {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`+${p.score}`, p.x, p.y - (60 - p.timer));
    });

    // Suspicious "Glitch" Effect
    if (Math.random() < 0.01) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      ctx.fillRect(Math.random() * CANVAS_WIDTH, Math.random() * CANVAS_HEIGHT, 50, 2);
    }
  };

  useEffect(() => {
    let animationFrameId: number;
    const render = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        update();
        draw(ctx);
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState]);

  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score, highScore]);

  const startGame = () => {
    initAudioContext();
    playSynthSound('CHOMP');
    initGame(false);
    setGameState('PLAYING');
  };

  const nextStage = () => {
    initGame(true);
    setGameState('PLAYING');
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameState !== 'PLAYING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const pacman = pacmanRef.current;
    const dx = mouseX - (pacman.x + TILE_SIZE / 2);
    const dy = mouseY - (pacman.y + TILE_SIZE / 2);

    // Only change direction if mouse is far enough from Pacman
    if (Math.abs(dx) > TILE_SIZE || Math.abs(dy) > TILE_SIZE) {
      if (Math.abs(dx) > Math.abs(dy)) {
        pacman.nextDir = dx > 0 ? 'RIGHT' : 'LEFT';
      } else {
        pacman.nextDir = dy > 0 ? 'DOWN' : 'UP';
      }
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (gameState === 'START') {
      startGame();
    }
  };

  const handleJoystickStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsJoystickActive(true);
    setJoystickPos({ x: 0, y: 0 });
  };

  const handleJoystickMove = (e: MouseEvent | TouchEvent) => {
    if (!isJoystickActive) return;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const joystickElement = document.getElementById('joystick-base');
    if (!joystickElement) return;

    const rect = joystickElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxRadius = 40;

    const limitedX = distance > maxRadius ? (dx / distance) * maxRadius : dx;
    const limitedY = distance > maxRadius ? (dy / distance) * maxRadius : dy;

    setJoystickPos({ x: limitedX, y: limitedY });

    if (distance > 10) {
      const pacman = pacmanRef.current;
      if (Math.abs(dx) > Math.abs(dy)) {
        pacman.nextDir = dx > 0 ? 'RIGHT' : 'LEFT';
      } else {
        pacman.nextDir = dy > 0 ? 'DOWN' : 'UP';
      }
    }
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (isJoystickActive) {
      window.addEventListener('mousemove', handleJoystickMove);
      window.addEventListener('mouseup', handleJoystickEnd);
      window.addEventListener('touchmove', handleJoystickMove, { passive: false });
      window.addEventListener('touchend', handleJoystickEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleJoystickMove);
      window.removeEventListener('mouseup', handleJoystickEnd);
      window.removeEventListener('touchmove', handleJoystickMove);
      window.removeEventListener('touchend', handleJoystickEnd);
    };
  }, [isJoystickActive]);

  const handleQuit = () => {
    setGameState('START');
    stopBgMusic();
  };

  return (
    <div 
      className="min-h-screen bg-[#050505] text-[#ff6600] font-mono flex flex-col items-center justify-center p-4 overflow-hidden select-none"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (gameState === 'START') {
          initAudioContext();
          startIntroMusic();
        }
      }}
    >
      {/* Phone Frame Wrapper */}
      <div className="relative w-full max-w-[420px] aspect-[9/19] bg-[#1a1a1a] rounded-[3rem] border-[8px] border-[#333] shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-[#333] rounded-b-2xl z-50" />
        
        <div className="flex-1 flex flex-col p-4 pt-10">
          {/* Header */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 text-center"
          >
            <h1 className="text-2xl md:text-3xl font-bold tracking-tighter uppercase italic flex items-center gap-2 justify-center">
              <Skull className="w-6 h-6 animate-pulse" />
              PACHIMON V2.5
              <Ghost className="w-6 h-6 animate-bounce" />
            </h1>
          </motion.div>

          {/* Game Container */}
          <div className="relative flex-1 flex flex-col min-h-0">
            <div className="relative bg-[#000] rounded-xl border border-[#331a00] shadow-inner overflow-hidden flex-1 flex flex-col">
              {/* Stats Bar */}
              <div className="flex justify-between items-center p-2 text-[10px] border-b border-[#331a00]">
                <div className="flex gap-2">
                  <span className="flex items-center gap-1">
                    <Candy className="w-3 h-3" /> {score.toString().padStart(6, '0')}
                  </span>
                </div>
                <div className="flex gap-2 items-center">
                  <div className="flex gap-0.5">
                    {Array.from({ length: lives }).map((_, i) => (
                      <div key={i} className="w-2 h-2 bg-[#ff6600] rounded-full animate-pulse" />
                    ))}
                  </div>
                  <div className="h-3 w-px bg-white/10 mx-1" />
                  <div className="flex gap-0.5 items-center">
                    {Array.from({ length: Math.min(stage, 5) }).map((_, i) => (
                      <Ghost key={i} className="w-3 h-3 text-[#ff6600] opacity-60" />
                    ))}
                    <span className="text-[9px] font-bold opacity-40 ml-0.5">S{stage}</span>
                  </div>
                </div>
              </div>

              {/* Canvas */}
              <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
                {gameState === 'PLAYING' && (
                  <>
                    <div className="absolute top-2 left-2 z-10 pointer-events-none">
                      <motion.div 
                        animate={{ y: [0, -2, 0], scale: [1, 1.02, 1] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        className="text-xl font-black text-[#ff9900] drop-shadow-[0_0_10px_rgba(255,153,0,0.9)] italic"
                      >
                        {consumptionRate}%
                      </motion.div>
                    </div>

                    {wallsLeft > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                        <motion.div 
                          key={wallsLeft}
                          initial={{ scale: 3, opacity: 0 }}
                          animate={{ scale: 1, opacity: 0.3 }}
                          className="text-[120px] font-black text-red-600/30 select-none"
                        >
                          {wallsLeft}
                        </motion.div>
                      </div>
                    )}

                    {/* Joystick UI */}
                    <div className="absolute bottom-6 left-6 z-30 opacity-50">
                      <div 
                        id="joystick-base"
                        onMouseDown={handleJoystickStart}
                        onTouchStart={handleJoystickStart}
                        className="w-24 h-24 bg-white/5 border-2 border-white/10 rounded-full flex items-center justify-center backdrop-blur-sm"
                      >
                        <motion.div 
                          animate={{ x: joystickPos.x * 0.75, y: joystickPos.y * 0.75 }}
                          transition={{ type: "spring", stiffness: 300, damping: 20 }}
                          className="w-10 h-10 bg-[#ff6600]/40 border border-white/20 rounded-full shadow-inner"
                        />
                      </div>
                    </div>

                    {/* QUIT Button */}
                    <button 
                      onMouseDown={(e) => { e.stopPropagation(); handleQuit(); }}
                      className="absolute bottom-4 right-4 z-20 px-3 py-1 bg-white/5 border border-white/10 rounded text-[8px] uppercase tracking-widest opacity-30"
                    >
                      QUIT
                    </button>
                  </>
                )}
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseDown={handleCanvasMouseDown}
                  className="block cursor-crosshair max-h-full max-w-full object-contain"
                />

                {/* Overlays */}
                <AnimatePresence>
                  {gameState !== 'PLAYING' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4 z-40"
                    >
                      {gameState === 'START' && (
                        <motion.div
                          initial={{ scale: 0.9 }}
                          animate={{ scale: 1 }}
                          className="space-y-4"
                        >
                          <h2 className="text-xl font-bold">READY?</h2>
                          <div className="text-[10px] opacity-70 space-y-1 text-left bg-white/5 p-3 rounded-lg border border-white/10">
                            <p>• Use <b>Joystick</b> or <b>Cursor</b>.</p>
                            <p>• <b>Candy</b>: Invincible + <b>5 walls</b>.</p>
                            <p>• Clear <b>75% dots</b> to advance.</p>
                            <p>• Watch out for <b>Falling Witches</b>!</p>
                          </div>
                          <button
                            onClick={startGame}
                            className="w-full py-3 bg-[#ff6600] text-black font-black rounded-full hover:bg-white transition-all transform active:scale-95 flex items-center justify-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            START
                          </button>
                        </motion.div>
                      )}

                      {gameState === 'GAMEOVER' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="space-y-6"
                        >
                          <h2 className="text-4xl font-black text-red-600">GAME END</h2>
                          <div className="space-y-1">
                            <div className="text-2xl font-bold">Score: {score}</div>
                            <div className="text-sm opacity-40 italic">Best: {highScore}</div>
                          </div>
                          <button
                            onClick={() => setGameState('START')}
                            className="px-8 py-3 bg-white text-black font-black rounded-full uppercase text-xs tracking-widest"
                          >
                            Title
                          </button>
                        </motion.div>
                      )}

                      {gameState === 'WON' && (
                        <motion.div
                          initial={{ scale: 1.2 }}
                          animate={{ scale: 1 }}
                          className="space-y-4"
                        >
                          <h2 className="text-3xl font-black text-green-500">CLEARED!</h2>
                          <p className="text-sm">Stage {stage} Survived.</p>
                          <div className="text-xl font-bold">Score: {score}</div>
                        </motion.div>
                      )}

                      {gameState === 'COUNTDOWN' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="space-y-4"
                        >
                          <h2 className="text-xl font-bold italic">STAGE {stage + 1}</h2>
                          <div className="text-6xl font-black animate-ping text-[#ff6600]">
                            {countdown}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Home Indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-1 bg-[#333] rounded-full" />
      </div>

      {/* Mute Toggle */}
      <button 
        onClick={() => setIsMuted(!isMuted)}
        className="mt-6 p-3 border border-[#331a00] rounded-full hover:bg-[#331a00] transition-colors"
      >
        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>

      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none z-[-1] opacity-10">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,#331a00,transparent_70%)]" />
      </div>
    </div>
  );
}
