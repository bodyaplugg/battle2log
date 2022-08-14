const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const projects = {
    bf2hub: {
        baseUrl: 'http://official.ranking.bf2hub.com/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0',
            Host: 'BF2web.gamespy.com'
        }
    },
    playbf2: {
        baseUrl: 'http://bf2web.playbf2.ru/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0'
        }
    },
    phoenix: {
        baseUrl: 'http://bf2.phoenixnetwork.net/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0'
        }
    }
};

const sources = {
    getplayerinfo: {
        endpoint: 'getplayerinfo.aspx',
        defaultParams: {
            info: 'per*,cmb*,twsc,cpcp,cacp,dfcp,kila,heal,rviv,rsup,rpar,tgte,dkas,dsab,cdsc,rank,cmsc,kick,kill,deth,suic,ospm,klpm,klpr,dtpr,bksk,wdsk,bbrs,tcdr,ban,dtpm,lbtl,osaa,vrk,tsql,tsqm,tlwf,mvks,vmks,mvn*,vmr*,fkit,fmap,fveh,fwea,wtm-,wkl-,wdt-,wac-,wkd-,vtm-,vkl-,vdt-,vkd-,vkr-,atm-,awn-,alo-,abr-,ktm-,kkl-,kdt-,kkd-'
        },
        requiredParams: ['pid'],
        propertyKeys: ['player']
    },
    getrankinfo: {
        endpoint: 'getrankinfo.aspx',
        requiredParams: ['pid'],
        defaultParams: {}
    },
    getawardsinfo: {
        endpoint: 'getawardsinfo.aspx',
        defaultParams: {},
        requiredParams: ['pid'],
        propertyKeys: ['awards']
    },
    getunlocksinfo: {
        endpoint: 'getunlocksinfo.aspx',
        defaultParams: {},
        requiredParams: ['pid'],
        propertyKeys: ['status', 'unlocks']
    },
    getleaderboard: {
        endpoint: 'getleaderboard.aspx',
        defaultParams: {
            type: 'score',
            id: 'overall'
        },
        requiredParams: [],
        propertyKeys: ['players'],
        forceReturnArray: true
    },
    searchforplayers: {
        endpoint: 'searchforplayers.aspx',
        defaultParams: {},
        requiredParams: ['nick'],
        propertyKeys: ['players'],
        forceReturnArray: true
    }
};

exports.lambdaHandler = async (event) => {
    let response = {
        headers: { 'Content-Type': 'application/json' }
    };

    try {
        const sourceKey = String(event.path || event.requestContext.http.path);
        if (!(sourceKey in sources)) {
            response.statusCode = 404;
            throw new Error('Invalid source provided');
        }

        const requiredParamsPresent = sources[sourceKey].requiredParams.every((param) => Object.keys(event.queryStringParameters).includes(param) && event.queryStringParameters[param].trim().length > 0);
        if (!event.queryStringParameters || !requiredParamsPresent) {
            response.statusCode = 422;
            throw new Error('Missing required query string paramter(s)');
        }

        if (sourceKey === 'searchforplayers' && event.queryStringParameters.where && event.queryStringParameters.where.toLowerCase() === 'e') {
            response.statusCode = 422;
            throw new Error('searchforplayers does not support "endswith"/"where=e" search');
        }

        const project = event?.queryStringParameters?.project in projects ? projects[event.queryStringParameters.project] : projects.bf2hub;

        const stats = await fetchFromSource(project, sources[sourceKey], event.queryStringParameters);

        if (sourceKey == 'getplayerinfo' && stats.player && !!event.queryStringParameters.groupValues) {
            stats.grouped = {
                armies: await groupStatsByRegex(stats.player, /^a(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                classes: await groupStatsByRegex(stats.player, /^k(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                vehicles: await groupStatsByRegex(stats.player, /^v(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                weapons: await groupStatsByRegex(stats.player, /^w(?<key>[a-zA-Z]+)-(?<index>\d+)$/)
            }
        }

        response.statusCode = 200;
        response.headers['Cache-Control'] = `max-age=${process.env.CACHE_TTL || 600}`;
        response.body = JSON.stringify(stats);
    } catch (err) {
        console.log(err);
        if (err.message === 'Player not found') {
            response.statusCode = 404;
        }
        if (!response.statusCode) response.statusCode = 500;
        response.body = JSON.stringify({ errors: [err.message] });
    }
    return response;
};

async function fetchFromSource(project, source, eventQueryParameters) {
    let response;
    const queryParams = { ...source.defaultParams, ...eventQueryParameters };
    const url = new URL(source.endpoint + '?' + Object.entries(queryParams).map((param) => `${param[0]}=${param[1]}`).join('&'), project.baseUrl);
    response = await fetch(url, {
        headers: project.defaultHeaders
    });

    const rawResponse = await response.text();
    const parsedResponse = await parseBf2Response(rawResponse, source.propertyKeys, source.forceReturnArray);

    return parsedResponse;
}

async function parseBf2Response(rawResponse, propertyKeys, forceReturnArray = false) {
    let lines = rawResponse.split('\n');

    const firstLine = lines.shift();
    if (firstLine.trim() != 'O') {
        const errMsg = firstLine == 'E\t998' || firstLine.startsWith('O	H	asof	D') || lines.join('').includes('Player Not Found')
            ? 'Player not found' :
            'Source query resulted in an error';
        throw errMsg;
    }

    let datasets = [];
    let lastDelimiterType;
    let dataLineIndex = 0;
    lines.forEach((line) => {
        switch (line.substr(0, 2)) {
        case 'H\t':
            lastDelimiterType = 'h';
            datasets.push({ h: line.substr(2), d: [] });
            break;
        case 'D\t':
            if (lastDelimiterType === 'd') {
                dataLineIndex++;
            }
            lastDelimiterType = 'd';
            datasets[datasets.length - 1].d[dataLineIndex] = line.substr(2);
            break;
        case '$\t':
            break;
        default:
            datasets[datasets.length - 1][lastDelimiterType] += line;
        }
    });

    let returnObj = {};
    datasets.forEach((dataset, datasetIndex) => {
        const keys = dataset.h.split('\t');
        const dataLines = dataset.d.map((line) => line.split('\t'));
        if (datasetIndex === 0) {
            keys.forEach((key, index) => returnObj[key] = dataLines[0][index]);
        }
        else if (dataLines.length === 1 && !forceReturnArray) {
            const propertyKey = propertyKeys[datasetIndex - 1];
            returnObj[propertyKey] = {};
            keys.forEach((key, index) => returnObj[propertyKey][key] = dataLines[0][index]);
        }
        else {
            const propertyKey = propertyKeys[datasetIndex - 1];
            returnObj[propertyKey] = dataLines.map((line) => Object.fromEntries(line.map((value, index) => [keys[index], value])));
        }
    });

    return returnObj;
}

async function groupStatsByRegex(playerStats, keyRegex) {
    const grouped = [];
    for (const key in playerStats) {
        const match = keyRegex.exec(key);
        if (match) {
            const index = Number(match.groups.index);
            if (!grouped[index]) {
                grouped[index] = { id: index };
            }
            grouped[index][match.groups.key] = playerStats[key];
        }
    }

    return grouped;
}
