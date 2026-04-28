const fsPromises = require('fs').promises;
const path = require('path');
const { log, logError } = require('./utils');

const DEFAULT_STATE_PATH = '/share/lg_pi485_state.json';

function getStatePath() {
    return process.env.LG_PI485_STATE_PATH || DEFAULT_STATE_PATH;
}

function createEmptyState() {
    return {
        discoveredClimateUnits: new Set(),
        discoveryPublishedThisRun: new Set(),
        climateStates: {},
    };
}

function normalizeState(raw = {}) {
    return {
        discoveredClimateUnits: new Set(raw.discoveredClimateUnits || []),
        discoveryPublishedThisRun: new Set(),
        climateStates: {},
    };
}

function serializeState(state) {
    return {
        discoveredClimateUnits: Array.from(state.discoveredClimateUnits),
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

        return createEmptyState();
    }
}

async function saveState(state, statePath = getStatePath()) {
    try {
        await fsPromises.mkdir(path.dirname(statePath), { recursive: true });
        await fsPromises.writeFile(statePath, JSON.stringify(serializeState(state), null, 2), 'utf8');
    } catch (err) {
        logError(`Error saving ${statePath}:`, err);
    }
}

module.exports = {
    createEmptyState,
    getStatePath,
    loadState,
    normalizeState,
    saveState,
    serializeState,
};
