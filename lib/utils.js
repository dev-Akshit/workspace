const _ = require('lodash');
const encrypt = require('argon2');
const crypto = require('crypto');

const config = require('../config/configVars');
const redisServices = require('../services/redisService');
const constants = require('../lib/constants');
const {redisKeys} = constants;



/**
 * 
 * @param {string} sid 
 * @throws If Sid is not provided for sid is not of type string.
 * @throws When not able to connect to the redis.
 */
const deleteSession = async function (sid) {
    if ( 
        !sid
        ||
        typeof sid !== 'string'
    )  {
        throw new Error(`Sid is not provided or invalid type sid: ${sid}`);
    }
    const sessionStr = `${constants.sessionPrefix}:${sid}`;
    await redisServices.sessionRedis('del', sessionStr);
}

const isInternalRouteAuthenticated = (req, res, next) => {
    if ( req && req.body && req.body.workspaceBackendKey == constants.workspaceBackendKey)  next();
    else    next(new Error("Not Authenticated"));
}

/**
 * 
 * @param {string} channelId 
 * @returns 
 */
const getChannelMessageRedisStreamName = (channelId) => {
    return channelId ? `${constants.redisKeys.channelMsgStream}:${channelId}` : '';
}

const getUserActivityRedisStreamName = (workspaceId, userId) => {
    if (!userId)    return ;
    if (workspaceId)    return `${constants.redisKeys.userActivityStream}:${workspaceId}:${userId}`;
    return `${constants.redisKeys.userActivityStream}:${workspaceId}:${userId}`;
}

let lockRedis = async function (keyName = constants.redisLockKeys.defaultKey) {
    try {
        const isLocked = await redisServices.redis('setnx', keyName, '1');
        if ( isLocked )     await redisServices.redis('expire', keyName, 60 * 2)
        return isLocked ? true : false;
    } catch (error) {
        console.log("Redis Lock key name = ", keyName);
        console.log("Error lockRedis, err = ", error);
        return false;
    }
}

/**
 * 
 * @param {undefined || string} keyName 
 * @returns 
 */
let unlockRedis = async function (keyName = constants.redisLockKeys.defaultKey) {
    try {
        const isUnlocked = await redisServices.redis('del', keyName);
        return true;
    } catch (error) {
        console.log("Redis Lock key name = ", keyName);
        console.log("Error unlockRedis, err = ", error);
        return false;
    }
}

const getConnectedSocketIdsOfRoom = async (roomId) => {
    try {
        let sockets = await io.in(roomId).fetchSockets() || [];
        return sockets.map(obj => obj.id);
    } catch (error) {
        console.log("Error getConnectedSocketIdsOfRoom, ", error);
        return [];
    }
}

const getOnlineUserIdsSetInChannelRoom = async (channelId) => {
    let userIdsSet = new Set();
    try {
        let socketIdsArr = await getConnectedSocketIdsOfRoom(channelId);
        if ( ! socketIdsArr.length )    return userIdsSet;

        let redisPipeline = global.redisClient.pipeline();
        socketIdsArr.map(socketId => redisPipeline.hgetall(`${redisKeys.socketDataHash}:${socketId}`));

        let pipelineOutput = await redisPipeline.exec() || [];
        pipelineOutput.map(element => {
            let userId = element && element.length && element[1] && element[1][redisKeys.userId];
            if ( userId )  userIdsSet.add(userId);
        })

        return userIdsSet;

    } catch (error) {
        console.log("Error getOnlineUserIdsSetInChannelRoom, ", error);
        return userIdsSet;
    }
}

const changeObjectKeysToCamelCase = (payload = {}) => {
    Object.keys(payload).map(keyName => {
        let newName = _.camelCase(keyName);
        if ( newName != keyName ) {
            payload[_.camelCase(keyName)] = payload[keyName];
            delete payload[keyName];
        }
    })
}

const encryptString = (stringToHash) => {
    return encrypt.hash(stringToHash);
}

const checkIfValidEncryption = (stringToCheck, encryptedString) => {
    return encrypt.verify(stringToCheck, encryptedString);
}

const getBaseConfig = () => {
    return {
        verificationBaseURL: `${config.host}/auth/verifyEmail`,
        workspaceInviteBaseURL:`${config.host}/auth/workspace/invite`,
        forgotPasswordBaseURL: `${config.frontendURL}/resetPassword`
    }
}

const hostUrl = () => {
    return `${config.host}`
}

const cloudStorageUrl = () =>{
    return `${config.cloudStorageUrl}`
}

/** @param {{[string]: any}} */
const createSessionObj = (userData) => {
    userData.sid = userData?.sid ?? crypto.randomBytes(40).toString('hex');
    const session = structuredClone(userData);

    return new Proxy(session, {
        set(target, key, value, receiver) {
            target[constants.sessionUpdateCheckFieldName] = true;
            return Reflect.set(target, key, value, receiver);
        },
        get(target, key, receiver) {
            if (key == 'save') {
                return () => {
                    redisServices.sessionRedis(`set`, `${constants.sessionPrefix}:${target.sid}`, JSON.stringify(target), 'EX', constants.sessionExpireTime_Seconds,(err) => {
                        if (err) {
                            console.error(`RED ALERT:Session Save Failed For the user\nUserId: ${target.userId}`)
                        }
                    })
                }
            }
            return Reflect.get(target, key, receiver);
        }
    });
}

/**
 * 
 * @param {string} token 
 */
const validateRecaptcha = async (token) => {
    const url = `https://www.google.com/recaptcha/api/siteverify`;
    try {
        const rawResponse = await fetch(url, {
            method: 'POST',
            body: `secret=${config.recaptchaSecretKey}&response=${token}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
        const response = await rawResponse.json();
        if (!response?.success) {
            throw new Error('Failed');
        }
    } catch (error) {
        console.log(error);
        throw new Error('ReCAPTCHA failed');
    }
}

module.exports = {
    deleteSession,
    isInternalRouteAuthenticated,
    getChannelMessageRedisStreamName,
    getUserActivityRedisStreamName,
    lockRedis,
    unlockRedis,
    getConnectedSocketIdsOfRoom,
    getOnlineUserIdsSetInChannelRoom,
    changeObjectKeysToCamelCase,
    encryptString,
    checkIfValidEncryption,
    getBaseConfig,
    hostUrl,
    cloudStorageUrl,
    createSessionObj,
    validateRecaptcha,
}