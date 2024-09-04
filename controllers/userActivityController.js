const {constants, utils} = require("../lib")
const {redisKeys, redisLockKeys} = constants;

const postgres = require("../config/postgres");
const {pool} = postgres;

const messageController = require('../controllers/messageController');
const redisService = require('../services/redisService');
const {userActivityModel} = require("../models");

const getUserActivityObjsFromStreamOutputArr = (streamArr = []) => {
    /*
        streamArr =  [["1642842550784-0",["messageId","613a46c6-55a7-4ea1-ad15-a7e4157e1c60"]], ["1642842550787-0",["messageId","613a46c6-55a7-4ea1-ad15-a7e4157e1c61"]]]
    */
    let userActivitiesArr = [];
    streamArr.map(item => {
        let userActivityObj = {};
        let arr = item[1];
        for (let index = 0; index < arr.length; index += 2) {
            userActivityObj[arr[index]] = arr[index+1];
        }
        userActivitiesArr.push(userActivityObj);
    })
    
    return userActivitiesArr;
}

const listUserActivities = async (payload) => {
    try {
        let { userId, workspaceId, channelId, lastSeen, limit, isPrevious, includeLastSeen } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! workspaceId )        throw new Error("Workspace Id is null");

        limit = parseInt(limit) || constants.defaultUserActivityCountLimit;
        lastSeen = parseInt(lastSeen);
        let q;

        const userActivityStreamName = utils.getUserActivityRedisStreamName(workspaceId, userId);
        const userActivityStreamLength = await redisService.redis('xlen', userActivityStreamName);
        let userActivitiesArr = [];
        let dbUserActivitiesArr = [];
        let redisUserActivitiesArr = [];

        if ( ! lastSeen || isPrevious ) {
            lastSeen = lastSeen || Date.now();
            if (includeLastSeen)      lastSeen += 1;
            if ( userActivityStreamLength ) {
                let streamData = await redisService.redis('xrevrange', userActivityStreamName, lastSeen - 1, '-', 'count', limit) || [];
                redisUserActivitiesArr = getUserActivityObjsFromStreamOutputArr(streamData);  
            }
            limit -= redisUserActivitiesArr.length;
            if (limit) {
                q = `SELECT * FROM ${userActivityModel.tableName} \
                    WHERE ${userActivityModel.columnName.user_id} = '${userId}' AND \
                        ${userActivityModel.columnName.channel_id} = '${channelId}' AND \
                        ${userActivityModel.columnName.created_at} < ${lastSeen} \
                    ORDER BY ${userActivityModel.columnName.created_at} DESC \
                    LIMIT ${limit}
                `;
                //console.log("q1 = ",q);
                let res1 = await pool.query(q);
                dbUserActivitiesArr = ( res1 && res1.rows ) || [];
            }
        }
        else {
            if (includeLastSeen)      lastSeen -= 1;
            q = `SELECT * FROM ${userActivityModel.tableName} \
                WHERE \
                    ${userActivityModel.columnName.user_id} = '${userId}' AND \
                    ${userActivityModel.columnName.channel_id} = '${channelId}' AND \
                    ${userActivityModel.columnName.created_at} > ${lastSeen} \
                    ORDER BY ${userActivityModel.columnName.created_at} ASC \
                LIMIT ${limit} \
            `;
            //console.log("q1 = ",q);
            let res1 = await pool.query(q);
            dbUserActivitiesArr = ( res1 && res1.rows ) || [];

            limit -= dbUserActivitiesArr.length
            if ( limit && userActivityStreamLength ) {
                let streamData = await redisService.redis('xrange', userActivityStreamName, lastSeen + 1, '+', 'count', limit) || [];
                redisUserActivitiesArr = getUserActivityObjsFromStreamOutputArr(streamData);
            }
        }

        dbUserActivitiesArr.map(obj => utils.changeObjectKeysToCamelCase(obj));
        userActivitiesArr = [...dbUserActivitiesArr, ...redisUserActivitiesArr];

        const messageIds = userActivitiesArr.map(obj => { if ( obj.messageId )   return obj.messageId});
        const messagesObj = await messageController.getMessagesDataFromIds(messageIds) || {};

        return {userActivitiesArr, messagesObj};

    } catch (error) {
        console.log("Error in listUserActivities. Error = ", error);
        throw error;
    }
}

const popUserActivityFromStream = async (streamName) => {
    try {
        const streamData = await redisService.redis('xrange', streamName, '-', '+', 'count', 1);
        const userActivitiesObjArr = getUserActivityObjsFromStreamOutputArr(streamData) || [];
        const userActivityObj = userActivitiesObjArr[0] || {};
        if ( Object.keys(userActivityObj).length == 0 )    throw new Error("UserActivity obj not created");

        const streamObjId = streamData && streamData[0] && streamData[0][0];
        const {id, workspaceId, channelId, messageId, replyId, userId, type, createdAt = Date.now()} = userActivityObj;
        if ( ! id )             throw new Error("ActivityId is null");
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! userId )         throw new Error("UserId is null");
        if ( ! type )           throw new Error("type is null");
        if ( ! createdAt )      throw new Error("CreatedAt is null");

        let q = `INSERT INTO ${userActivityModel.tableName} \
            ( \
                ${userActivityModel.columnName.id}, \
                ${userActivityModel.columnName.workspace_id}, \
                ${userActivityModel.columnName.channel_id}, \
                ${userActivityModel.columnName.message_id}, \
                ${userActivityModel.columnName.reply_id}, \
                ${userActivityModel.columnName.user_id}, \
                ${userActivityModel.columnName.type}, \
                ${userActivityModel.columnName.created_at} \
            ) \
            VALUES \
            ( \
                '${id}', \
                '${workspaceId}', \
                ${channelId ? ( "\'" + channelId + "\'" ) : 'NULL'}, \
                ${messageId ? ( "\'" + messageId + "\'" ) : 'NULL'}, \
                ${replyId ? ( "\'" + replyId + "\'" ) : 'NULL'}, \
                '${userId}', \
                ${type}, \
                ${createdAt} \
            ) \
            RETURNING ${userActivityModel.columnName.id} \
        `;
        let res = await pool.query(q);
        let activityId = res && res.rows && res.rows.length && res.rows[0] && res.rows[0][userActivityModel.columnName.id];
        if ( ! activityId )     throw new Error("Activity not added");
        
        await redisService.redis('xdel', streamName, streamObjId);

        console.log(`User Activity id= ${activityId} written to Db`);
        return ;

    } catch (error) {
        console.log("popUserActivityFromStream, Error = ", error);
        throw new Error(error.message);
    }
}

const writeUserActivityToDb = async () => {
    let userId, workspaceId;
    try {
        const isDbWritePaused = await redisService.redis('get', redisKeys.pauseDbWrite);
        if ( parseInt(isDbWritePaused) )     return ;

        const isLockAvailable = await utils.lockRedis(redisLockKeys.userActivityStreamKey);
        if ( ! isLockAvailable )    return ;

        userIdStr = await redisService.redis('spop', redisKeys.activeUsersActivityStreamSet) || '';
        if (userIdStr.indexOf(':') == -1)   userId = userIdStr;
        else                                [workspaceId, userId] = userIdStr.split(':');

        if ( userId && typeof(userId) == "string" ) {
            const streamName = utils.getUserActivityRedisStreamName(workspaceId, userId);
            const streamLength = await redisService.redis('xlen', streamName);
            for (let index = 0; index < streamLength; index++) {
                await popUserActivityFromStream(streamName);
            }
        } 
        utils.unlockRedis(redisLockKeys.userActivityStreamKey);
        return ;
    } catch (error) {
        console.log("writeUserActivityToDb, Error = ", error);
        utils.unlockRedis(redisLockKeys.userActivityStreamKey);
        return ;
    }
}

const startUserActivityWriteInterval = function() {
    setInterval( () => {
        writeUserActivityToDb();
    }, 10000);
}

module.exports = {
    listUserActivities,
    startUserActivityWriteInterval,
}