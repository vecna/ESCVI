const _ = require('lodash');
const moment = require('moment');
const Promise = require('bluebird');
const debug = require('debug')('routes:statistics');
const nconf = require('nconf');

const mongo = require('../lib/mongo');
const utils = require('../lib/utils');

/* -- this cache is shared with yttrex, might be generalized or figured out 
 * if something native from mongo exists ? */

const cache = {};
const cacheTime = 120;

function formatCached(what, updated) {

    let ref = _.get(cache, what, {
        content: null,
        computedAt: null,
        next: null,
    });
    if(updated) {
        ref.content = updated.content;
        ref.computedAt = updated.computedAt;
        ref.next = updated.next;
        _.set(cache, what, ref);
    }
    if(!ref.content) throw new Error("Invalid cache usage");
    return {
        json: {
            content: ref.content,
            computedt: ref.computedAt.toISOString(),
            next: ref.next.toISOString(),
            cacheTimeSeconds: cacheTime,
        }
    };
};

function cacheAvailable(what) {
    let ref = _.get(cache, what);
    if(!ref)
        return null;
    if(ref.next && moment().isAfter(ref.next))
        return null;
    if(!ref.content)
        return null;

    return true;
}

function countStoredDocuments() {
    const p = {};
    const aweekago = moment().subtract(1, 'week').toISOString();
    const timeVars = {
        impressions: 'impressionTime',
        supporters: 'keyTime',
        timelines: 'startTime',
        accesses: 'when',
        htmls: 'savingTime',
        metadata: 'impressionTime',
        errors: 'when',
        summary: 'impressionTime',
        anomalies: 'when',
        semantics: 'when',
        labels: 'when',
        // feeds: "feeds",
        aggregated: 'hourOnly',
    };

    return Promise
        .map(_.keys(timeVars), function(c) {
            let lastwtv = _.set({}, timeVars[c], { "$gte": new Date(aweekago) });
            return Promise.all([
                mongo.count(nconf.get('schema')[c]),
                mongo.count(nconf.get('schema')[c], lastwtv)
            ])
            .tap(function(numbers) {
                _.set(p, c, numbers[0]);
                _.set(p, `${c}_lw`, numbers[1]);
            });
        }, { concurrency: 1 })
        .return(p);
};

function counter(req) {

    return Promise.resolve().then(function() {
        if(cacheAvailable('counter'))
            return formatCached('counter');
    })
    .then(function(tbd) {
        if(tbd) return tbd;
        return countStoredDocuments()
            .then(function(fresh) {
                const updated = {
                    content: fresh,
                    computedAt: moment(),
                    next: moment().add(cacheTime, 'seconds')
                };
                return formatCached('counter', updated);
            })
            .catch(function(error) {
                debug("Error in counter: %s", error.message);
                return { json: { error: true, message: error.message }};
            });
    });
}

function parsers(req) {
    // the content in 'aggregated' is saved by parserv in regards of parsed content
    const days = 14;
    debug("Requested aggregated parsers results (last %d days hardcoded)", days);
    const twoWeeks = moment().subtract(days, 'days');
    const expected = 24 * days;
    return mongo
        .read(nconf.get('schema').aggregated, { hourOnly: { $gt: new Date(twoWeeks) }})
        .then(function(all) {
            if(_.size(all) != expected)
                debug("(?) Returning %d elements on %d expected", _.size(all), expected);
            return { json: all };
        });
};

function statistics(req) {
    // the content in 'stats' is saved by count-o-clock and the selector here required is 
    // specifiy in config/stats.json
    const name = req.params.name;
    const days = 14;
    debug("Requested statistics [%s] (last %d days hardcoded)", name, days);
    const twoWeeks = moment().subtract(days, 'days');
    const expected = 24 * days;
    return mongo
        .read(nconf.get('schema').stats, { hour: { $gt: new Date(twoWeeks) }, name: name })
        .then(function(all) {
            if(_.size(all) != expected)
                debug("(?) Returning %d elements on %d expected", _.size(all), expected);
            return { json: all };
        });
}

module.exports = {
    counter,
    statistics,
    parsers
};
