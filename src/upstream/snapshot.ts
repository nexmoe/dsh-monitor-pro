// Adapted from nexmoe/vscode-monitor-pro at 36b8f7487d2b6d3b9d6b210e372c18cb824eb25d.
// Licensed under Apache-2.0; see LICENSE and NOTICE.
// Extracted snapshot types only; this module has no VS Code runtime dependency.
interface GpuCard { model: string; utilization: number; temperature: number; memTotal: number; memUsed: number }

export interface SystemSnapshot {
  timestamp: number;
  currentLoad: number;
  // Per-CPU usage (%), ordered by core index. Empty when the active data
  // source cannot provide per-core data (e.g. the Go backend).
  currentLoadCores: number[];
  mem: {
    total: number;
    free: number;
    used: number;
    active: number;
    available: number;
    buffcache: number;
    buffers: number;
    cached: number;
    slab: number;
    reclaimable: number;
    swaptotal: number;
    swapused: number;
    swapfree: number;
    writeback: number | null;
    dirty: number | null;
  };
  osInfo: {
    platform: string;
    distro: string;
    release: string;
    codename: string;
    kernel: string;
    arch: string;
    hostname: string;
    fqdn: string;
    codepage: string;
    logofile: string;
    serial: string;
    build: string;
    servicepack: string;
    uefi: boolean | null;
  };
  networkStats: {
    iface: string;
    operstate: string;
    rx_bytes: number;
    rx_dropped: number;
    rx_errors: number;
    tx_bytes: number;
    tx_dropped: number;
    tx_errors: number;
    rx_sec: number;
    tx_sec: number;
    ms: number;
  }[];
  fsStats: {
    rx: number;
    wx: number;
    tx: number;
    rx_sec: number | null;
    wx_sec: number | null;
    tx_sec: number | null;
    ms: number;
  };
  fsSize: {
    fs: string;
    type: string;
    size: number;
    used: number;
    available: number;
    use: number;
    mount: string;
    rw: boolean | null;
  }[];
  cpuCurrentSpeed: {
    min: number;
    max: number;
    avg: number;
    cores: number[];
  };
  cpuTemperature: {
    main: number;
    cores: number[];
    max: number;
  };
  // Retained upstream field; the Go backend produces an empty GPU list.
  // Harness uses its own Sample type for NVIDIA and mactop GPU readings.
  gpu: {
    cards: GpuCard[];
  };
  battery: {
    hasBattery: boolean;
    cycleCount: number;
    isCharging: boolean;
    voltage: number;
    designedCapacity: number;
    maxCapacity: number;
    currentCapacity: number;
    capacityUnit: string;
    percent: number;
    health: number;
    powerRate: number;
    powerState: "charging" | "discharging" | "full" | "idle" | "none";
    timeRemaining: number;
    acConnected: boolean;
    type: string;
    model: string;
    manufacturer: string;
    serial: string;
  };
  time: {
    uptime: number;
    timezone: string;
    timezoneName: string;
    current: number;
  };
  unavailableMetrics: string[];
}
