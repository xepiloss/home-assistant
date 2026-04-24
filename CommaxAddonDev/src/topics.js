function joinTopic(...parts) {
    return parts
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join('/');
}

function createTopicBuilder(prefix) {
    return {
        prefix,
        path: (...parts) => joinTopic(prefix, ...parts),
        availability: (...parts) => joinTopic(prefix, ...parts, 'availability'),
        discovery: (...parts) => joinTopic('homeassistant', ...parts, 'config'),
    };
}

module.exports = {
    createTopicBuilder,
    joinTopic,
};
