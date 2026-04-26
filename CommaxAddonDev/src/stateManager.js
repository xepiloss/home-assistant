const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { log, logError } = require('./utils');

const DEFAULT_STATE_PATH = '/share/commax_ew11_state.json';
const LOCAL_STATE_PATH = path.join(process.cwd(), '.local-test', 'commax_ew11_state.json');

function getStatePath(statePath = process.env.COMMAX_STATE_PATH) {
    if (statePath) {
        return statePath;
    }

    return fs.existsSync('/share') ? DEFAULT_STATE_PATH : LOCAL_STATE_PATH;
}

function createInitialState() {
    return {
        discoveredOutlets: new Set(),
        discoveredLights: new Set(),
        discoveredTemps: new Set(),
        discoveredFans: new Set(),
        discoveredElevators: new Set(),
        discoveredMasterLights: new Set(),
        discoveredSensors: new Set(),
        discoveredMeters: new Set(),
        lifeInfoState: {
            wallpadTimeDiscovered: false,
            wallpadTimeDiscoveryVersion: 0,
            lastPublishedWallpadTime: null,
            lifeInfoTemperatureDiscovered: false,
            lifeInfoTemperatureDiscoveryVersion: 0,
            lifeInfoOutdoorPm10Discovered: false,
            rawPacketDiscovered: false,
            lastWallpadTime: null,
        },
        monthlyMeteringState: {
            period: null,
            baselines: {},
            appliedUsageConfig: {
                period: null,
                values: {},
            },
        },
        parkingState: {
            parkingDiscovered: false,
            carNumberDiscovered: false,
            iconDiscoveryVersion: 0,
        },
    };
}

function normalizeState(raw = {}) {
    const initialState = createInitialState();

    return {
        ...initialState,
        discoveredOutlets: new Set(raw.discoveredOutlets || []),
        discoveredLights: new Set(raw.discoveredLights || []),
        discoveredTemps: new Set(raw.discoveredTemps || []),
        discoveredFans: new Set(raw.discoveredFans || []),
        discoveredElevators: new Set(raw.discoveredElevators || []),
        discoveredMasterLights: new Set(raw.discoveredMasterLights || []),
        discoveredSensors: new Set(raw.discoveredSensors || []),
        discoveredMeters: new Set(raw.discoveredMeters || []),
        lifeInfoState: {
            wallpadTimeDiscovered: raw.lifeInfoState?.wallpadTimeDiscovered || false,
            wallpadTimeDiscoveryVersion: raw.lifeInfoState?.wallpadTimeDiscoveryVersion || 0,
            lastPublishedWallpadTime: raw.lifeInfoState?.lastPublishedWallpadTime || null,
            lifeInfoTemperatureDiscovered: raw.lifeInfoState?.lifeInfoTemperatureDiscovered || false,
            lifeInfoTemperatureDiscoveryVersion: raw.lifeInfoState?.lifeInfoTemperatureDiscoveryVersion || 0,
            lifeInfoOutdoorPm10Discovered: raw.lifeInfoState?.lifeInfoOutdoorPm10Discovered || false,
            rawPacketDiscovered: raw.lifeInfoState?.rawPacketDiscovered || false,
            lastWallpadTime: raw.lifeInfoState?.lastWallpadTime || null,
        },
        monthlyMeteringState: {
            period: raw.monthlyMeteringState?.period || null,
            baselines: raw.monthlyMeteringState?.baselines || {},
            appliedUsageConfig: {
                period: raw.monthlyMeteringState?.appliedUsageConfig?.period || null,
                values: raw.monthlyMeteringState?.appliedUsageConfig?.values || {},
            },
        },
        parkingState: {
            parkingDiscovered: raw.parkingState?.parkingDiscovered || false,
            carNumberDiscovered: raw.parkingState?.carNumberDiscovered || false,
            iconDiscoveryVersion: raw.parkingState?.iconDiscoveryVersion || 0,
        },
    };
}

function serializeState(state) {
    return {
        discoveredOutlets: Array.from(state.discoveredOutlets),
        discoveredLights: Array.from(state.discoveredLights),
        discoveredTemps: Array.from(state.discoveredTemps),
        discoveredFans: Array.from(state.discoveredFans),
        discoveredElevators: Array.from(state.discoveredElevators),
        discoveredMasterLights: Array.from(state.discoveredMasterLights),
        discoveredSensors: Array.from(state.discoveredSensors),
        discoveredMeters: Array.from(state.discoveredMeters),
        lifeInfoState: {
            wallpadTimeDiscovered: state.lifeInfoState.wallpadTimeDiscovered,
            wallpadTimeDiscoveryVersion: state.lifeInfoState.wallpadTimeDiscoveryVersion || 0,
            lastPublishedWallpadTime: state.lifeInfoState.lastPublishedWallpadTime || null,
            lifeInfoTemperatureDiscovered: state.lifeInfoState.lifeInfoTemperatureDiscovered || false,
            lifeInfoTemperatureDiscoveryVersion: state.lifeInfoState.lifeInfoTemperatureDiscoveryVersion || 0,
            lifeInfoOutdoorPm10Discovered: state.lifeInfoState.lifeInfoOutdoorPm10Discovered || false,
            rawPacketDiscovered: state.lifeInfoState.rawPacketDiscovered,
            lastWallpadTime: state.lifeInfoState.lastWallpadTime,
        },
        monthlyMeteringState: {
            period: state.monthlyMeteringState.period,
            baselines: state.monthlyMeteringState.baselines,
            appliedUsageConfig: state.monthlyMeteringState.appliedUsageConfig || {
                period: null,
                values: {},
            },
        },
        parkingState: {
            parkingDiscovered: state.parkingState.parkingDiscovered,
            carNumberDiscovered: state.parkingState.carNumberDiscovered,
            iconDiscoveryVersion: state.parkingState.iconDiscoveryVersion || 0,
        },
    };
}

async function loadState(statePath = getStatePath()) {
    try {
        const data = await fsPromises.readFile(statePath, 'utf8');
        return normalizeState(JSON.parse(data));
    } catch (err) {
        if (err.code === 'ENOENT') {
            log(`No ${statePath} found, starting fresh.`);
        } else {
            logError(`Error loading ${statePath}:`, err);
        }

        return createInitialState();
    }
}

let pendingSave = Promise.resolve();

async function persistState(state, statePath) {
    try {
        await fsPromises.mkdir(path.dirname(statePath), { recursive: true });
        await fsPromises.writeFile(statePath, JSON.stringify(serializeState(state), null, 2), 'utf8');
    } catch (err) {
        logError(`Error saving ${statePath}:`, err);
    }
}

function saveState(state, statePath = getStatePath()) {
    pendingSave = pendingSave
        .catch(() => undefined)
        .then(() => persistState(state, statePath));

    return pendingSave;
}

module.exports = {
    DEFAULT_STATE_PATH,
    LOCAL_STATE_PATH,
    STATE_PATH: DEFAULT_STATE_PATH,
    createInitialState,
    getStatePath,
    loadState,
    normalizeState,
    saveState,
    serializeState,
};
