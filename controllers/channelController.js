const { v4: uuidv4 } = require('uuid');
const postgreUtil = require('pg/lib/utils');
const axios = require('axios');

const utils = require('../lib/utils');

const constants = require('../lib/constants');
const {redisKeys} = constants;

const postgres = require("../config/postgres");
const {pool} = postgres;

const {cqBackendUrl, redisPassword} = require("../config/configVars");

const {userModel, workspaceModel, channelModel, userWorkspaceDataModel, userChannelDataModel, messageModel, notificationModel} = require("../models");
const userController = require('../controllers/userController');
const notificationController = require('../controllers/notificationController');

const redisService = require('../services/redisService');
const userService = require('../services/userService');

const getOneChannel = async (channelId) => {
    const q = `SELECT * FROM ${channelModel.tableName} WHERE ${channelModel.columnName.id} = '${channelId}'`;
    const res = await pool.query(q);
    const channelObj = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
    return channelObj;
}

const getTotalMsgCountOfChannel = async (payload) => {
    try {
        const {channelId, setExpiry, useCache = true} = payload;
        if ( ! channelId )      throw new Error("ChannelId is null");

        const msgCountKeyName = `${constants.redisKeys.messageCount}:${channelId}`;
        if (useCache) {
            let count = await redisService.redis('get', msgCountKeyName);
            count = parseInt(count);
            if ( count || count === 0 ) {
                if (setExpiry)  redisService.redis('expire', msgCountKeyName, constants.rediskeyExpiryTimesInSec.channelMsgCount);
                return count;
            }
        }

        let q = `SELECT COUNT(*) \
            FROM ${messageModel.tableName} \
            WHERE ${messageModel.columnName.channel_id} = '${channelId}' \    
        `
        let res = await pool.query(q);
        count = res && res.rows && res.rows[0] && res.rows[0].count;
        count = parseInt(count) || 0;

        count += await redisService.redis('xlen', utils.getChannelMessageRedisStreamName(channelId)) || 0;

        if (count) {
            redisService.redis('set', msgCountKeyName, count, 'ex', constants.rediskeyExpiryTimesInSec.channelMsgCount);
        }
        return count;
    } catch (error) {
        console.log("Error in getTotalMessageCount. Error = ", error);
        throw error;
    }
}

const getTotalMessageCountOfChannelsFromRedis = async (channelIds = []) => {
    try {
        const channelsTotalMessageCountObj = {};
        const redisPipeline = global.redisClient.pipeline();
        channelIds.map(channelId => redisPipeline.get(`${constants.redisKeys.messageCount}:${channelId}`));
        const pipelineOutput = await redisPipeline.exec() || [];
        pipelineOutput.map( (arr = [], index) => {
            const totalMessageCount = parseInt(arr[1]);
            if ( totalMessageCount || totalMessageCount == 0 )    channelsTotalMessageCountObj[channelIds[index]] = totalMessageCount;
        })
        return channelsTotalMessageCountObj;
    } catch (error) {
        console.log("Error in getTotalMessageCountOfChannelsFromRedis. Error = ", error);
        throw error;
    }
}

const getTotalMessageCountOfChannelsFromDb = async (channelIds = []) => {
    try {
        const channelsTotalMessageCountObj = {};
        const q = `SELECT ${messageModel.columnName.channel_id}, COUNT(*) \
            FROM ${messageModel.tableName} \
            WHERE ${messageModel.columnName.channel_id} = ANY('${postgreUtil.prepareValue(channelIds)}'::UUID[]) \
            GROUP BY ${messageModel.columnName.channel_id} \
        `;
        const res = await pool.query(q) || [];
        (res.rows || []).map((obj) => {
            const {channel_id, count} = obj || {};
            if ( channel_id )   channelsTotalMessageCountObj[channel_id] = parseInt(count);
        })
        return channelsTotalMessageCountObj;
    } catch (error) {
        console.log("Error in getTotalMessageCountOfChannelsFromDb. Error = ", error);
        throw error;
    }
}

const getTotalMessageCountOfChannels= async (channelIds = [])  => {
    try {
        if ( ! channelIds.length )     return {};
        let channelsTotalMessageCountObj = {}, channelsTotalMessageCountObjRedis = {}, channelsTotalMessageCountObjDb = {};

        channelsTotalMessageCountObjRedis = await getTotalMessageCountOfChannelsFromRedis(channelIds);

        const channelIdsNotInRedis = channelIds.filter(channelId => ! Object(channelsTotalMessageCountObjRedis).hasOwnProperty(channelId));
        if ( channelIdsNotInRedis.length ) {
            channelsTotalMessageCountObjDb = await getTotalMessageCountOfChannelsFromDb(channelIdsNotInRedis);

            const redisPipeline = global.redisClient.pipeline();
            channelIdsNotInRedis.map(channelId => redisPipeline.xlen(utils.getChannelMessageRedisStreamName(channelId)));
            const pipelineOutput = await redisPipeline.exec() || [];
            pipelineOutput.map( (arr = [], index) => {
                const totalMessageCount = parseInt(arr[1]);
                channelsTotalMessageCountObjDb[channelIdsNotInRedis[index]] = (channelsTotalMessageCountObjDb[channelIdsNotInRedis[index]] || 0) + (totalMessageCount || 0) ;
            })
            channelIdsNotInRedis.map((channelId, index) => {
                const keyName = `${constants.redisKeys.messageCount}:${channelId}`;
                redisService.redis('setnx', keyName, channelsTotalMessageCountObjDb[channelIdsNotInRedis[index]], (err, isSet) => {
                    if ( isSet )    redisService.redis('expire', keyName, constants.rediskeyExpiryTimesInSec.channelMsgCount);
                })
            })
        }

        channelsTotalMessageCountObj = {...channelsTotalMessageCountObjRedis, ...channelsTotalMessageCountObjDb};
        return channelsTotalMessageCountObj;
    } catch (error) {
        console.log("Error in getTotalMessageCountOfChannels. Error = ", error);
        throw error;
    }
}

const addUserToChannel = async (payload = {}) => {
    let isPrevTransaction = payload.isPrevTransaction && payload.client ? true : false;
    let client, q, res, timeStamp = payload.timeStamp || Date.now();

    if (isPrevTransaction)  client = payload.client;
    else                    client = await pool.connect();
    try {
        if ( ! isPrevTransaction )  await client.query('BEGIN');

        let { userId, workspaceId, channelId, createdBy } = payload;
        if ( ! userId )             throw new Error("UserId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");
        if ( ! createdBy )          throw new Error("CreatedBy is null");

        await userController.isUserExist({userId, upsert: false, createdBy, timeStamp});

        // Check if user alread added
        q = `SELECT ${channelModel.columnName.id} \
            FROM ${channelModel.tableName} \
            WHERE ${channelModel.columnName.id} = '${channelId}' AND \
	    	${channelModel.columnName.user_ids}  @> ARRAY['${userId}']::VARCHAR(100)[] \
        `;
        res = await pool.query(q);
        res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
        if (res[channelModel.columnName.id] == channelId) {
            return {msg: 'User already added'};
        } 

        // Query to add userId in channel document
        q = `UPDATE ${channelModel.tableName} \
            SET \
	    	    ${channelModel.columnName.user_ids} = ARRAY_APPEND(${channelModel.columnName.user_ids}, '${userId}'), \
		        ${channelModel.columnName.removed_user_ids} = ARRAY_REMOVE(${channelModel.columnName.removed_user_ids}, '${userId}') \
            WHERE \
                ${channelModel.columnName.id} = '${channelId}' AND \
                ${channelModel.columnName.workspace_id} = '${workspaceId}' AND \
                NOT ( ${channelModel.columnName.user_ids} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
            RETURNING ${channelModel.columnName.id}, ${channelModel.columnName.type}, ${channelModel.columnName.created_by} \
        `
        res = await client.query(q);
        res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
        const channelType = res[channelModel.columnName.type];
        const channelCreatedBy = res[channelModel.columnName.created_by];

        // Query to insert workspaceId in user document
        q = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.workspace_ids} = ARRAY_APPEND(${userModel.columnName.workspace_ids}, '${workspaceId}') \
            WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.workspace_ids} @> ARRAY['${workspaceId}']::UUID[] ) \
        `
        await client.query(q);
        
        // Query to insert channelId in user document
        q = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.channel_ids} = ARRAY_APPEND(${userModel.columnName.channel_ids}, '${channelId}') \
            WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
        `
        await client.query(q);

        const channelMsgCount = await getTotalMsgCountOfChannel({channelId, workspaceId});

        // Query to insert user-channel-data in user document
        q = `INSERT INTO ${userChannelDataModel.tableName} \
            ( \
                ${userChannelDataModel.columnName.user_id}, \
                ${userChannelDataModel.columnName.workspace_id}, \
                ${userChannelDataModel.columnName.channel_id}, \
                ${userChannelDataModel.columnName.total_read}, \
                ${userChannelDataModel.columnName.created_by} \
            ) \
            VALUES \
            ( \
                '${userId}', \
                '${workspaceId}', \
                '${channelId}', \
                '${channelMsgCount}', \
                '${createdBy}' \
            ) \
            ON CONFLICT (${userChannelDataModel.columnName.channel_id}, ${userChannelDataModel.columnName.user_id}) DO NOTHING \
        `;
        await client.query(q);

        // Query to insert user-workspace-data in user document
        q = `INSERT INTO ${userWorkspaceDataModel.tableName} \
            ( \
                ${userWorkspaceDataModel.columnName.workspace_id}, \
                ${userWorkspaceDataModel.columnName.user_id}, \
                ${userWorkspaceDataModel.columnName.channel_ids}, \
                ${userWorkspaceDataModel.columnName.created_by} \
            ) \
            VALUES \
            ( \
                '${workspaceId}',\
                '${userId}',\
                '${postgreUtil.prepareValue([channelId])}',\
                '${createdBy}'\
            ) \
            ON CONFLICT \
            ( \
                ${userWorkspaceDataModel.columnName.workspace_id}, \
                ${userWorkspaceDataModel.columnName.user_id} \
            ) \
            DO UPDATE SET \
                ${userWorkspaceDataModel.columnName.channel_ids} = ARRAY_APPEND(${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids}, '${channelId}') \
            WHERE \
                NOT ( ${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
        `;
        await client.query(q);

        if ( channelCreatedBy != userId ) {
            // Query to insert notification
            q = `INSERT INTO ${notificationModel.tableName} \
                ( \
                    ${notificationModel.columnName.workspace_id}, \
                    ${notificationModel.columnName.channel_id}, \
                    ${notificationModel.columnName.user_id}, \
                    ${notificationModel.columnName.type}, \
                    ${notificationModel.columnName.created_by} \
                ) \
                VALUES \
                ( \
                    '${workspaceId}', \
                    '${channelId}', \
                    '${userId}', \
                    '${constants.notificationTypes.addChannelType}', \
                    '${createdBy}' \
                ) \
            `;
            await client.query(q);
        }
        
        if ( ! isPrevTransaction ) { 
            await client.query('COMMIT');
            await client.release();
            //io.to(channelId).emit('newUserAdded', {userIds: [userId]});

            notificationController.emitUserNotifications({userIds: [userId]});
        }

        return {msg: "Added"};
    } catch (error) {
        if ( ! isPrevTransaction ) {
            await client.query('ROLLBACK');
            await client.release();
        }
        console.log("Failed query = ", q);
        console.log("Error in addUserToWorkSpace. Error = ", error);
        throw error;
    }
}

const removeUserFromChannel = async (payload) => {
    const client = await pool.connect();
    let q, res;
    try {
        await client.query('BEGIN');

        let { userId, workspaceId, channelId } = payload;
        if ( ! userId )                 throw new Error("UserId is null");
        if ( ! channelId )              throw new Error("ChannelId is null");
        if ( ! workspaceId )            throw new Error("WorkspaceId is null");

        // Query to remove userId in channel document
        q = `UPDATE ${channelModel.tableName} \
            SET \
                ${channelModel.columnName.user_ids} = ARRAY_REMOVE(${channelModel.columnName.user_ids}, '${userId}'), \
                ${channelModel.columnName.removed_user_ids} = ARRAY_APPEND(${channelModel.columnName.removed_user_ids}, '${userId}') \
            WHERE ${channelModel.columnName.id} = '${channelId}' \
        `
        await client.query(q);

        // Query to remove channelId in user document
        q = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.channel_ids} = ARRAY_REMOVE(${userModel.columnName.channel_ids}, '${channelId}') \
            WHERE ${userModel.columnName.id} = '${userId}' \
            RETURNING ${userModel.columnName.channel_ids} \
        `
        //console.log("q2 = ", query2);
        res = await client.query(q);

        const userChannelIds = ( res && res.rows && res.rows.length && res.rows[0][`${userModel.columnName.channel_ids}`] ) || [];

        // Query to get channel ids of current workspace
        q = `SELECT ${workspaceModel.columnName.channel_ids} \
            FROM ${workspaceModel.tableName} \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' \            
        `
        res = await client.query(q);
        const workspaceChannelIds = ( res && res.rows && res.rows.length && res.rows[0][`${workspaceModel.columnName.channel_ids}`] ) || [];

        // user has any channel of workspace yet, if not then remove workspace id from user document
        let channelIds = workspaceChannelIds.filter(id => userChannelIds.indexOf(id) != -1);
        if ( channelIds.length === 0 ) {
            q = `UPDATE ${userModel.tableName} \
                SET ${userModel.columnName.workspace_ids} = ARRAY_REMOVE(${userModel.columnName.workspace_ids}, '${workspaceId}') \
                WHERE ${userModel.columnName.id} = '${userId}' \
            `
            await client.query(q);

            // remove user-workspace-data
            q = `DELETE FROM ${userWorkspaceDataModel.tableName} \
                WHERE \
                    ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' AND \
                    ${userWorkspaceDataModel.columnName.user_id} = '${userId}'\
            `;
            await client.query(q);

            // Delete all user workspace notifications
            q = `DELETE FROM ${notificationModel.tableName} \
                WHERE \
                    ${notificationModel.columnName.user_id} = '${userId}' AND \
                    ${notificationModel.columnName.workspace_id} = '${workspaceId}' \
            `;
            await client.query(q);

        }
        else {
            q = `UPDATE ${userWorkspaceDataModel.tableName} \
                SET ${userWorkspaceDataModel.columnName.channel_ids} = ARRAY_REMOVE(${userWorkspaceDataModel.columnName.channel_ids}, '${channelId}') \
                WHERE \
                    ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' AND \
                    ${userWorkspaceDataModel.columnName.user_id} = '${userId}'\
            `;
            await client.query(q);

            // Delete all user channel notifications
            q = `DELETE FROM ${notificationModel.tableName} \
                WHERE \
                    ${notificationModel.columnName.user_id} = '${userId}' AND \
                    ${notificationModel.columnName.workspace_id} = '${workspaceId}' AND \
                    ${notificationModel.columnName.channel_id} = '${channelId}' \
            `;
            await client.query(q);
        }

        // remove user-channel-data
        q = `DELETE FROM ${userChannelDataModel.tableName} \
            WHERE \
                ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                ${userChannelDataModel.columnName.user_id} = '${userId}'\
        `;
        await client.query(q);

        await client.query('COMMIT');
        await client.release();

        return {msg: "Removed"};
    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Failed query = ", q);
        console.log("Error in removeUserFromChannel. Error = ", error);
        throw error;
    }
}

// TODO - Need to optimise
const removeMultipleUsersFromChannel = async (payload) => {
    try {
        let { workspaceId, channelId, userIds = [] } = payload;
        if ( ! workspaceId )        throw new Error("WorkspaceId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");
        if ( ! userIds.length )     throw new Error("UserIds array is if zero length");

        for (let index = 0; index < userIds.length; index++) {
            const userId = userIds[index];
            await removeUserFromChannel({userId, workspaceId, channelId})
        }

        return {msg: `${userIds.length} users removed from channelId ${channelId}`};
    } catch (error) {
        console.log("Error in removeMultipleUsersFromChannel. Error = ", error);
        throw error;
    }
}

// TODO - Need to optimise
const addMultipleUsersToChannel = async (payload = {}) => {
    let client, q, res, currentTimestamp = Date.now();
    let isPrevTransaction = payload.isPrevTransaction && payload.client ? true : false;
    if (isPrevTransaction)  client = payload.client;
    else                    client = await pool.connect();
    try {
        if ( ! isPrevTransaction )  await client.query('BEGIN');

        let { workspaceId, channelId, userIds = [], createdBy, timeStamp = currentTimestamp } = payload;
        if ( ! userIds )             throw new Error("UserId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");
        if ( ! userIds.length )     throw new Error("UserIds array is if zero length");

        const alreadyExistingUserIdsSet = new Set();

        q = `SELECT ${userModel.columnName.id} \
            FROM ${userModel.tableName} \
            WHERE ${userModel.columnName.id} = ANY('${postgreUtil.prepareValue(userIds)}'::VARCHAR(100)[])`;
        res = await client.query(q);
        res = ( res && res.rows ) || [];
        res.map(obj => alreadyExistingUserIdsSet.add(obj[userModel.columnName.id]));

        const remainingUserIds = userIds.filter(uId => ! alreadyExistingUserIdsSet.has(uId));
        if ( remainingUserIds.length ) {
            await userController.addUsers({userIds: remainingUserIds, createdBy, timeStamp});
        }

        // Get channel Data
        q = `SELECT \
                ${channelModel.columnName.id}, \
                ${channelModel.columnName.user_ids}, \
                ${channelModel.columnName.removed_user_ids} \
            FROM ${channelModel.tableName} \
            WHERE ${channelModel.columnName.id} = '${channelId}' \
        `
        res = await client.query(q);
        const channelObj = ( res && res.rows && res.rows[0] ) || {};
        const {id, user_ids: channelUserIds = [], removed_user_ids: channelRemovedUserIds = []} = channelObj;
        if ( ! id )     throw new Error("Channel Id is null");

        // Update user_ids in channel document
        const channelUserIdsSet = new Set(channelUserIds.concat(userIds));
        const updatedChannelUserIds = [...channelUserIdsSet];
        const updatedChannelRemovedUserIds = channelRemovedUserIds.filter(uId => ! channelUserIdsSet.has(uId));

        q = `UPDATE ${channelModel.tableName} \
            SET \
                ${channelModel.columnName.user_ids} = '${postgreUtil.prepareValue(updatedChannelUserIds)}', \
                ${channelModel.columnName.removed_user_ids} = '${postgreUtil.prepareValue(updatedChannelRemovedUserIds)}' \
            WHERE \
                ${channelModel.columnName.id} = '${channelId}' AND \
                ${channelModel.columnName.workspace_id} = '${workspaceId}' \
        `;
        res = await client.query(q);

        // Get channel users documents
        q = `SELECT \
                ${userModel.columnName.id}, \
                ${userModel.columnName.workspace_ids}, \
                ${userModel.columnName.channel_ids} \
            FROM ${userModel.tableName} \
            WHERE ${userModel.columnName.id} = ANY('${postgreUtil.prepareValue(userIds)}'::VARCHAR(100)[]) \
        `;

        res = await client.query(q);
        const usersDataArr = ( res && res.rows ) || [];
        const usersObj = {};
        const wUserIds = [];  // UserIds in which workspaceId needs to be pushed in its document
        const cUserIds = [];  // UserIds in which channelId needs to be pushed in its document
        usersDataArr.map((obj = {}) => {
            usersObj[obj.id] = obj;
            const {workspace_ids: workspaceIds = [], channel_ids: channelIds = []} = obj;
            if ( workspaceIds.indexOf(workspaceId) == -1 )  wUserIds.push(obj.id);
            if ( channelIds.indexOf(channelId) == -1 )      cUserIds.push(obj.id);
        });

        if ( wUserIds.length ) {
            // Query to insert workspaceId in user document
            q = `UPDATE ${userModel.tableName} \
                SET ${userModel.columnName.workspace_ids} = ARRAY_APPEND(${userModel.columnName.workspace_ids}, '${workspaceId}') \
                WHERE ${userModel.columnName.id} = ANY('${postgreUtil.prepareValue(wUserIds)}'::VARCHAR(100)[]) \
            `
            res = await client.query(q);
        }

        if ( cUserIds.length ) {
            // Query to insert channelId in user document
            q = `UPDATE ${userModel.tableName} \
                SET ${userModel.columnName.channel_ids} = ARRAY_APPEND(${userModel.columnName.channel_ids}, '${channelId}') \
                WHERE ${userModel.columnName.id} = ANY('${postgreUtil.prepareValue(cUserIds)}'::VARCHAR(100)[]) \
            `
            res = await client.query(q);
        }

        // Check existing user channel data document
        q = `SELECT ${userChannelDataModel.columnName.user_id} \
            FROM ${userChannelDataModel.tableName} \
            WHERE \
                ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                ${userChannelDataModel.columnName.user_id} = ANY('${postgreUtil.prepareValue(userIds)}'::VARCHAR(100)[]) \
            `
        res = await client.query(q);
        const usersChannelData = ( res && res.rows ) || [];
        const userIdsHavingChannelDataSet = new Set(usersChannelData.map(obj => obj.user_id));
        const newUserIdsAdded = [];

        let valueString = '';

        // Adding userChannelData
        userIds.map((uId, index) => {
            if ( ! uId || userIdsHavingChannelDataSet.has(uId) )    return ;
            if ( index && valueString )  valueString += ',';
            valueString += `( \
                '${uId}', \
                '${workspaceId}', \
                '${channelId}', \
                '${createdBy || uId}' \
            )`;
            newUserIdsAdded.push(uId);
        });

        if ( valueString ) {
            q = `INSERT INTO ${userChannelDataModel.tableName} \
                ( \
                    ${userChannelDataModel.columnName.user_id}, \
                    ${userChannelDataModel.columnName.workspace_id}, \
                    ${userChannelDataModel.columnName.channel_id}, \
                    ${userChannelDataModel.columnName.created_by} \
                ) \
                VALUES ${valueString} \
            `;
            await client.query(q);
        }

        // Check existing user workspace data document
        q = `SELECT ${userWorkspaceDataModel.columnName.user_id} \
            FROM ${userWorkspaceDataModel.tableName} \
            WHERE \
                ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' AND \
                ${userWorkspaceDataModel.columnName.user_id} = ANY('${postgreUtil.prepareValue(userIds)}'::VARCHAR(100)[]) \
            `
        res = await client.query(q);
        const usersWorkspaceData = ( res && res.rows ) || [];
        const userIdsHavingWorkspaceDataSet = new Set(usersWorkspaceData.map(obj => obj.user_id));

        valueString = '';

        // Adding userWorkspaceData
        userIds.map((uId, index) => {
            if ( ! uId || userIdsHavingWorkspaceDataSet.has(uId) )    return ;
            if ( index && valueString )  valueString += ',';
            valueString += `( \
                '${uId}', \
                '${workspaceId}', \
                '${postgreUtil.prepareValue([channelId])}', \
                '${createdBy || uId}' \
            )`;
        });

        if ( valueString ) {
            q = `INSERT INTO ${userWorkspaceDataModel.tableName} \
                ( \
                    ${userWorkspaceDataModel.columnName.user_id}, \
                    ${userWorkspaceDataModel.columnName.workspace_id}, \
                    ${userWorkspaceDataModel.columnName.channel_ids}, \
                    ${userWorkspaceDataModel.columnName.created_by} \
                ) \
                VALUES ${valueString} \
            `;
            await client.query(q);
        }

        if ( userIdsHavingWorkspaceDataSet.size ) {
            q = `UPDATE ${userWorkspaceDataModel.tableName} \
                SET ${userWorkspaceDataModel.columnName.channel_ids} = ARRAY_APPEND(${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids}, '${channelId}') \
                WHERE \
                    ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' AND \
                    ${userWorkspaceDataModel.columnName.user_id} = ANY('${postgreUtil.prepareValue([...userIdsHavingWorkspaceDataSet])}'::VARCHAR(100)[]) AND \
                    NOT ( ${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
            `;
            await client.query(q);
        }

        valueString = '';

        // Adding userNotifications
        newUserIdsAdded.map((uId, index) => {
            if ( ! uId )    return ;
            if ( index && valueString )  valueString += ',';
            valueString += `( \
                '${workspaceId}', \
                '${channelId}', \
                '${uId}', \
                ${constants.notificationTypes.addChannelType}, \
                '${createdBy || uId}' \
            )`;
        });

        if ( valueString ) {
            q = `INSERT INTO ${notificationModel.tableName} \
                ( \
                    ${notificationModel.columnName.workspace_id}, \
                    ${notificationModel.columnName.channel_id}, \
                    ${notificationModel.columnName.user_id}, \
                    ${notificationModel.columnName.type}, \
                    ${notificationModel.columnName.created_by} \
                ) \
                VALUES ${valueString} \
            `;
            await client.query(q);
        }

        // Add channelId in user document

        // for (let index = 0; index < userIds.length; index++) {
        //     const userId = userIds[index];

        //     // Query to add userId in channel document DONE
        //     q = `UPDATE ${channelModel.tableName} \
        //         SET \
		// 	        ${channelModel.columnName.user_ids} = ARRAY_APPEND(${channelModel.columnName.user_ids}, '${userId}'), \
		// 	        ${channelModel.columnName.removed_user_ids} = ARRAY_REMOVE(${channelModel.columnName.removed_user_ids}, '${userId}') \
        //         WHERE \
        //             ${channelModel.columnName.id} = '${channelId}' AND \
        //             ${channelModel.columnName.workspace_id} = '${workspaceId}' AND \
        //             NOT ( ${channelModel.columnName.user_ids} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
        //         RETURNING ${channelModel.columnName.id} \
        //     `
        //     res = await client.query(q);
        //     const cId = res && res.rows && res.rows[0] && res.rows[0].id;
        //     if ( cId != channelId ){
        //         continue ;
        //     };

        //     // Query to insert workspaceId in user document DONE
        //     q = `UPDATE ${userModel.tableName} \
        //         SET ${userModel.columnName.workspace_ids} = ARRAY_APPEND(${userModel.columnName.workspace_ids}, '${workspaceId}') \
        //         WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.workspace_ids} @> ARRAY['${workspaceId}']::UUID[] ) \
        //     `
        //     res = await client.query(q);
            
        //     // Query to insert channelId in user document DONE
        //     q = `UPDATE ${userModel.tableName} \
        //         SET ${userModel.columnName.channel_ids} = ARRAY_APPEND(${userModel.columnName.channel_ids}, '${channelId}') \
        //         WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
        //     `
        //     res = await client.query(q);

        //     // Query to insert user-channel-data in user document  DONE
        //     q = `INSERT INTO ${userChannelDataModel.tableName} \
        //         ( \
        //             ${userChannelDataModel.columnName.user_id}, \
        //             ${userChannelDataModel.columnName.workspace_id}, \
        //             ${userChannelDataModel.columnName.channel_id}, \
        //             ${userChannelDataModel.columnName.created_by} \
        //         ) \
        //         VALUES \
        //         ( \
        //             '${userId}', \
        //             '${workspaceId}', \
        //             '${channelId}', \
        //             '${createdBy}' \
        //         ) \
        //         ON CONFLICT (${userChannelDataModel.columnName.channel_id}, ${userChannelDataModel.columnName.user_id}) DO NOTHING \
        //     `;
        //     res = await client.query(q);

        //     // Query to insert user-workspace-data in user document DONE
        //     q = `INSERT INTO ${userWorkspaceDataModel.tableName} \
        //         ( \
        //             ${userWorkspaceDataModel.columnName.workspace_id}, \
        //             ${userWorkspaceDataModel.columnName.user_id}, \
        //             ${userWorkspaceDataModel.columnName.channel_ids}, \
        //             ${userWorkspaceDataModel.columnName.created_by} \
        //         ) \
        //         VALUES \
        //         ( \
        //             '${workspaceId}',\
        //             '${userId}',\
        //             '${postgreUtil.prepareValue([channelId])}',\
        //             '${createdBy}'\
        //         ) \
        //         ON CONFLICT \
        //         ( \
        //             ${userWorkspaceDataModel.columnName.workspace_id}, \
        //             ${userWorkspaceDataModel.columnName.user_id} \
        //         ) \
        //         DO UPDATE SET \
        //             ${userWorkspaceDataModel.columnName.channel_ids} = ARRAY_APPEND(${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids}, '${channelId}') \
        //         WHERE \
        //             NOT ( ${userWorkspaceDataModel.tableName}.${userWorkspaceDataModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
        //     `;
        //     res = await client.query(q);
            

        //     // Query to insert notification DONE
        //     q = `INSERT INTO ${notificationModel.tableName} \
        //     ( \
        //         ${notificationModel.columnName.workspace_id}, \
        //         ${notificationModel.columnName.channel_id}, \
        //         ${notificationModel.columnName.user_id}, \
        //         ${notificationModel.columnName.type}, \
        //         ${notificationModel.columnName.created_by} \
        //     ) \
        //     VALUES \
        //     ( \
        //         '${workspaceId}', \
        //         '${channelId}', \
        //         '${userId}', \
        //         '${constants.notificationTypes.addChannelType}', \
        //         '${createdBy}' \
        //     ) \
        // `;
        //     res = await client.query(q);
        //     console.log(`User added. Id = ${userId}`);
        // }
        
        if ( ! isPrevTransaction ) {
            await client.query('COMMIT');
            await client.release();

            //io.to(channelId).emit('newUserAdded', {newUserIdsAdded});
            notificationController.emitUserNotifications({userIds});
        }

        return {msg: "All users added", addedUserIds: newUserIdsAdded};
    } catch (error) {
        if ( ! isPrevTransaction ) {
            await client.query('ROLLBACK');
            await client.release();
        }
        console.log("Failed query = ", q);
        console.log("Error in addMultipleUsersToChannel. Error = ", error);
        throw error;
    }
}

const createChannel = async (payload) => {
    const client = await pool.connect();
    let q, res;
    try {
        const timeStamp = Date.now();
        await client.query('BEGIN');

        let { userId, name, workspaceId, type = constants.channelTypes.basicType, userIdsToAdd = [], prevChannelId } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! name )               throw new Error("Channel Name is null");
        if ( ! workspaceId )        throw new Error("Workspace Id is null");

        if ( prevChannelId ) {
            await setLastSeenOfChannel({channelId: prevChannelId, userId, timeStamp: timeStamp-1});   // timeStamp decremented by 1 so that the new channel becomes the most recent in last_active
        }

        if ( type == constants.channelTypes.privateType ) {
            let userIds = [userId, ...userIdsToAdd];
            if ( userIds.length == 2 ) {
                userIds.sort();
                // TODO validate this
                name = userIds.join('-');
            }
        }
        
        // Insert into channel table
        q = `INSERT INTO ${channelModel.tableName} \
            ( \
                ${channelModel.columnName.name}, \
                ${channelModel.columnName.type}, \
                ${channelModel.columnName.created_by}, \
                ${channelModel.columnName.workspace_id} \
            ) \
            VALUES \
            ( \
                '${name}', \
                ${type}, \
                '${userId}', \
                '${workspaceId}'
            ) \
            RETURNING ${channelModel.columnName.id} \
        `;
        //console.log("q1 = ",query1);
        res = await client.query(q);

        let channelId = res && res.rows && res.rows.length && res.rows[0] && res.rows[0].id;
        if ( ! channelId )    throw new Error("Channel Id is null");
        //console.log("Channel Id = ", channelId);
        
        
        // Query to add channelId in workspace document
        q = `UPDATE ${workspaceModel.tableName} \
            SET ${workspaceModel.columnName.channel_ids} = ARRAY_APPEND(${workspaceModel.columnName.channel_ids}, '${channelId}') \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' AND NOT ( ${workspaceModel.columnName.channel_ids} @> ARRAY['${channelId}']::UUID[] ) \
        `
        //console.log("q2 = ",query2);
        res = await client.query(q);

        await addUserToChannel({userId, channelId, workspaceId, 'createdBy': userId, isPrevTransaction: true, client, timeStamp});

        for (let index = 0; index < userIdsToAdd.length; index++) {
            await addUserToChannel({'userId': userIdsToAdd[index], channelId, workspaceId, 'createdBy': userId, isPrevTransaction: true, client, timeStamp})
        }

        await client.query('COMMIT');
        await client.release();

        if ( userIdsToAdd.length ) {
            notificationController.emitUserNotifications({userIds: userIdsToAdd});
        }
        
        return {channelId, workspaceId};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in createChannel. Error = ", error);
        throw error;
    }
}

const listChannels = async (payload) => {
    try {
        let { userId, workspaceId } = payload;
        if ( ! userId )             throw new Error("UserId is null");
        if ( ! workspaceId )        throw new Error("WorkspaceId is null");
        const q1 = `SELECT \
                ${channelModel.tableName}.${channelModel.columnName.id}, \
                ${channelModel.tableName}.${channelModel.columnName.type}, \
                ${channelModel.tableName}.${channelModel.columnName.name}, \
                ${channelModel.tableName}.${channelModel.columnName.user_ids}, \
                ${channelModel.tableName}.${channelModel.columnName.batch_ids}, \
                ${channelModel.tableName}.${channelModel.columnName.created_by}, \
                ${channelModel.tableName}.${channelModel.columnName.write_permission_type}, \
                ${channelModel.tableName}.${channelModel.columnName.pinned_message_id}, \
                ${channelModel.tableName}.${channelModel.columnName.pinned_by}, \
                ${userChannelDataModel.tableName}.${userChannelDataModel.columnName.total_read}, \
                ${userChannelDataModel.tableName}.${userChannelDataModel.columnName.last_seen} \
            FROM ${channelModel.tableName} \
            JOIN ${userChannelDataModel.tableName} ON ${channelModel.tableName}.${channelModel.columnName.id} = ${userChannelDataModel.tableName}.${userChannelDataModel.columnName.channel_id} \
            WHERE ${channelModel.columnName.id} = ANY(ARRAY(\
                    SELECT ${userWorkspaceDataModel.columnName.channel_ids} \
                    FROM ${userWorkspaceDataModel.tableName} \
                    WHERE \
                        ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' AND \
                        ${userWorkspaceDataModel.columnName.user_id} = '${userId}' \
                )) AND \
                ${channelModel.columnName.state} = ${constants.state.active} AND \
                ${userChannelDataModel.columnName.user_id} = '${userId}' \
            `;
        
        //console.log("q1 = ", q1);
        const res1 = await pool.query(q1);
        const channelsArr = ( res1 && res1.rows && res1.rows ) || [];

        const privateChannelsObj = {};
        let lastActiveChannelId, lastSeen;
        let userIdsSet = new Set(), usersData = {};
        const channelIds = channelsArr.map(obj => obj.id);
        const channelsTotalMessageCountObj = await getTotalMessageCountOfChannels(channelIds);

        for (let index = 0; index < channelsArr.length; index++) {
            const channelObj = channelsArr[index];
            const channelId = channelObj.id;
            const channelLastSeen = parseInt(channelObj['last_seen']);
            if ( channelLastSeen && ( ! lastSeen || channelLastSeen > lastSeen ) ) {
                lastSeen = channelLastSeen;
                lastActiveChannelId = channelId;
            }
            channelObj.totalMsgCount = channelsTotalMessageCountObj[channelId] || 0;
            if ( channelObj.type == constants.channelTypes.privateType ) {
                privateChannelsObj[channelId] = channelObj;
                let [u1,u2] = privateChannelsObj[channelId].user_ids;
                if ( u1 )   userIdsSet.add(u1);
                if ( u2 )   userIdsSet.add(u2);
                channelObj.user1 = u1;
                channelObj.user2 = u2;
            }
            userIdsSet.add(channelObj.created_by);
        }

        if ( userIdsSet.size ) {
            usersData = await userController.getUsersData([...userIdsSet]);
            Object.keys(privateChannelsObj).map(channelId => {
                const channelObj = privateChannelsObj[channelId];
                const {user1, user2} = channelObj;
                const dmUserId = ( user1 == userId && user2 ) || ( user2 == userId && user1 );
                channelObj.name = (usersData[dmUserId] || {}).displayname || channelObj.name;
            })
        }

        //console.log("Channel arr = ", channelsArr);
        return {channelsArr, usersData, lastActiveChannelId};
    } catch (error) {
        console.log("Error in listChannels. Error = ", error);
        throw error;
    }
}

const editChannelName = async (payload) =>{
    try {
        let {channelId,updatedChannelName} = payload;
        if( ! channelId )              throw new Error("ChannelId is null");
        if( ! updatedChannelName )     throw new Error("updated channel name is null");

        const q1 = `UPDATE ${channelModel.tableName} \
            SET \
                ${channelModel.columnName.name} = '${updatedChannelName}' \
            WHERE \
                ${channelModel.columnName.id} = '${channelId}' \
        `

        const res1 = await pool.query(q1);

        //console.log(res1);

        return {msg:'Edited',channelId};
    } catch (error) {
        console.log("Error in edit channel name = ",error);
        throw error;
    }
}

const setLastSeenOfChannel = async (payload) => {
    try {
        let { userId, channelId, timeStamp = Date.now() } = payload;
        if ( ! userId )             throw new Error("UserId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");

        let channelMsgCount = await getTotalMsgCountOfChannel({...payload, setExpiry: true});
        let q1 = `UPDATE ${userChannelDataModel.tableName} \
                SET \
                    ${userChannelDataModel.columnName.total_read} = ${channelMsgCount}, \
                    ${userChannelDataModel.columnName.last_seen} = ${timeStamp} \
                WHERE ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                    ${userChannelDataModel.columnName.user_id} = '${userId}'
            `
        console.log("q1 = ", q1);
        const res1 = await pool.query(q1);
        return {msg: "Done"};
    } catch (error) {
        console.log("Error in setLastSeenOfChannel. Error = ", error);
        throw error;
    }
}

// DEPRECIATED
const setLastReadOfChannel = async (payload) => {
    try {
        let { userId, workspaceId, channelId, lastRead } = payload;
        if ( ! userId )             throw new Error("UserId is null");
        if ( ! workspaceId )        throw new Error("WorkspaceId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");
        if ( ! lastRead )           throw new Error("LastRead is null");

        let q1 = `UPDATE ${userChannelDataModel.tableName} \
                SET ${userChannelDataModel.columnName.last_read} = ${lastRead} \
                WHERE ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                    ${userChannelDataModel.columnName.user_id} = '${userId}' AND \
                    ${userChannelDataModel.columnName.workspace_id} = '${workspaceId}'\
            `
        //console.log("q1 = ", q1);
        const res1 = await pool.query(q1);
        return {msg: "Done"};
    } catch (error) {
        console.log("Error in setLastReadOfChannel. Error = ", error);
        throw error;
    }
}

const addBatchToChannel = async ( payload ) => {
    const timeStamp = Date.now();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let { workspaceId, channelId, batchId, createdBy } = payload;
        if ( ! workspaceId )        throw new Error("WorkspaceId is null");
        if ( ! channelId )          throw new Error("ChannelId is null");
        if ( ! batchId )            throw new Error("BatchId is null");

        let data = await axios.post(`${cqBackendUrl}/api/batch/addChannel`, {workspaceId, channelId, batchId,  workspaceBackendKey: constants.workspaceBackendKey});
        //console.log("Data = ", data.data);
        let userIds = ( data && data.data && data.data.userIds ) || [];

        // Add batchId to channel document
        let q1 = `UPDATE ${channelModel.tableName} \
            SET ${channelModel.columnName.batch_ids} = ARRAY_APPEND(${channelModel.columnName.batch_ids}, '${batchId}') \
            WHERE \
                ${channelModel.columnName.id} = '${channelId}' AND \
                ${channelModel.columnName.workspace_id} = '${workspaceId}' AND \
                NOT ( ${channelModel.columnName.batch_ids} @> ARRAY['${batchId}']::VARCHAR(100)[] ) \
            RETURNING ${channelModel.columnName.id} \
        `
        let res = await client.query(q1);
        let updatedChannelId = res && res.rows && res.rows.length && res.rows[0].id;
        if ( ! updatedChannelId )   throw new Error("Channel not updated");
        let obj = {};
        if ( userIds.length ) {
            obj = await addMultipleUsersToChannel({workspaceId, channelId, userIds, createdBy, isPrevTransaction: true, client, timeStamp}) || {};
        }
        
        await client.query('COMMIT');
        await client.release();

        notificationController.emitUserNotifications({userIds: obj.addedUserIds || []});
        return {};
    } catch (error) {
        console.log("Error in addBatchToChannel. Error = ", error);
        await client.query('ROLLBACK');
        await client.release();
        throw error;
    }
}

const setLastSeenOnSocketDisconnection = async (payload) => {
    try {
        const {userId, socketId} = payload;
        if ( ! userId )         throw new Error("UserId is null");
        if ( ! socketId )       throw new Error("SocketId is null");

        let channelId = await redisService.redis('hget', `${redisKeys.socketDataHash}:${socketId}`, redisKeys.channelId);
        if ( channelId ) {
            setLastSeenOfChannel({userId, channelId});
            redisService.redis('del', `${redisKeys.userChannelDataHash}:${userId}`);
            io.to(channelId).emit('userLeftChannel', {userId, channelId});
        }
        redisService.redis('hdel', `${redisKeys.socketDataHash}:${socketId}`, redisKeys.channelId);
        return ;
    } catch (error) {
        console.log("Error setLastSeenOnSocketDisconnection = ", error);
        throw error;
    }
}

const addChannelInActiveChannelsSet = async (payload) => {
    try {
        const {channelId} = payload;
        if ( ! channelId )         throw new Error("ChannelId is null");

        await redisService.redis('sadd', redisKeys.activeChannelIdsSet, channelId);
        return ;

    } catch (error) {
        console.log("Error addChannelInActiveChannelsSet = ", error);
        throw error;
    }
}

const removeChannelFromActiveChannelsSet = async (payload) => {
    try {
        const {channelId} = payload;
        if ( ! channelId )         throw new Error("ChannelId is null");

        await redisService.redis('srem', redisKeys.activeChannelIdsSet, channelId);
        return ;

    } catch (error) {
        console.log("Error removeChannelFromActiveChannelsSet = ", error);
        throw error;
    }
}

const getUserChannelDataObj = async (payload) => {
    try {
        const {channelId, userId} = payload;
        if ( ! channelId )      throw new Error("ChannelId is null");
        if ( ! userId )         throw new Error("UserId is null");

        let userChannelDataObj = await redisService.redis('hgetall', `${redisKeys.userChannelDataHash}:${userId}`);
        if ( userChannelDataObj && Object.keys(userChannelDataObj).length ) {
            userChannelDataObj.likedMessageIds = JSON.parse(userChannelDataObj[redisKeys.likedMessageIds] || '[]');
            userChannelDataObj.unlikedMessageIds = JSON.parse(userChannelDataObj[redisKeys.unlikedMessageIds] || '[]');
        }
        else {
            let q = `SELECT * FROM ${userChannelDataModel.tableName} \
                WHERE \
                    ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                    ${userChannelDataModel.columnName.user_id} = '${userId}' \
            `
            let res = await pool.query(q);
            userChannelDataObj = ( res && res.rows && res.rows[0] ) || {};
            utils.changeObjectKeysToCamelCase(userChannelDataObj);
            userChannelDataObj.likedMessageIds = JSON.stringify(userChannelDataObj.likedMessageIds || []);
            userChannelDataObj.unlikedMessageIds = JSON.stringify(userChannelDataObj.unlikedMessageIds || []);

            await redisService.redis('hmset', `${redisKeys.userChannelDataHash}:${userId}`, userChannelDataObj);
            redisService.redis('expire', `${redisKeys.userChannelDataHash}:${userId}`, 172800);
        }
        return userChannelDataObj;

    } catch (error) {
        console.log("Error getUserChannelDataObj = ", error);
        throw error;
    }
}

const setChannelWritePermissionValue = async (payload = {}) => {
    const {channelId, permissionValue} = payload;
    if ( ! channelId )          throw new Error("ChannelId is null");
    if ( ! permissionValue )    throw new Error("Permission Value is null");

    const q = `UPDATE ${channelModel.tableName} \
        SET ${channelModel.columnName.write_permission_type} = ${permissionValue} \
        WHERE ${channelModel.columnName.id} = '${channelId}' \
        RETURNING ${channelModel.columnName.id}, ${channelModel.columnName.workspace_id} \
    `;

    const res = await pool.query(q);
    const id = res && res.rows && res.rows.length && res.rows[0] && res.rows[0][channelModel.columnName.id];
    const workspaceId = res?.rows?.[0]?.[channelModel.columnName.workspace_id];
    if (!workspaceId) throw new Error('Something went wrong.');
    if ( ! id )     throw new Error("Channel not found");

    redisService.redis('set', `${redisKeys.channelWritePermissionValue}:${channelId}`, permissionValue, 'ex', 172800);
    io.to(workspaceId).emit('changePermission', payload);

    return permissionValue || 0;
}

const getChannelWritePermissionValue = async (channelId) => {
    if ( ! channelId )  throw new Error("ChannelId is null");
    let permissionValue = await redisService.redis('get', `${redisKeys.channelWritePermissionValue}:${channelId}`);
    if ( ! permissionValue ) {
        let q = `SELECT ${channelModel.columnName.write_permission_type} \
            FROM ${channelModel.tableName} \
            WHERE ${channelModel.columnName.id} = '${channelId}' \
        `;
        let res = await pool.query(q);
        permissionValue = res && res.rows && res.rows.length && res.rows[0] && res.rows[0][channelModel.columnName.write_permission_type];
        if ( permissionValue ) {
            redisService.redis('set', `${redisKeys.channelWritePermissionValue}:${channelId}`, permissionValue, 'ex', 172800);
        }
    }
    return permissionValue || 0;
}

const setPinMessage = async (payload) => {
    const {messageId, userId, channelId,workspaceId} = payload;
    if ( ! messageId )  throw new Error("MessageId is null");
    if ( ! channelId )  throw new Error("MessageId is null");
    if ( ! userId )     throw new Error("UserId is null");
    if ( ! channelId )     throw new Error("channelId is null");

    const q = `UPDATE ${channelModel.tableName} \
        SET ${channelModel.columnName.pinned_message_id} = '${messageId}' , \
            ${channelModel.columnName.pinned_by} = '${userId}' \
        WHERE ${channelModel.columnName.id} = '${channelId}' \
        RETURNING ${channelModel.columnName.id} \
    `
    const res = await pool.query(q);
    const id = res && res.rows && res.rows.length && res.rows[0] && res.rows[0][channelModel.columnName.id];
    if ( ! id )     throw new Error("Channel not found");

    io.to(workspaceId).emit('addPin', payload);

    return {msg: "Pin message added"};
}

const removePinMessage = async (payload) => {
    const {messageId, userId,channelId,workspaceId} = payload;
    if ( ! messageId )  throw new Error("MessageId is null");
    if ( ! userId )     throw new Error("UserId is null");
    if ( ! channelId )     throw new Error("channelId is null");

    const q = `UPDATE ${channelModel.tableName} \
        SET ${channelModel.columnName.pinned_message_id} = NULL , \
            ${channelModel.columnName.pinned_by} = NULL \
        WHERE ${channelModel.columnName.id} = '${channelId}' \
        RETURNING ${channelModel.columnName.id} \
    `
    const res = await pool.query(q);
    const id = res && res.rows && res.rows.length && res.rows[0] && res.rows[0][channelModel.columnName.id];
    if ( ! id )     throw new Error("Channel not found");

    io.to(workspaceId).emit('removePin', payload);
    
    return {msg: "Pin message removed"};
}

const getTotalUnreadMessagesCount = async (payload) => {
    let q, res;
    try {
        let userId = payload.userId;
        if ( ! userId )     throw new Error("UserId is null");
        q = `SELECT ${userWorkspaceDataModel.columnName.channel_ids} \
            FROM ${userWorkspaceDataModel.tableName} \
            WHERE ${userWorkspaceDataModel.columnName.user_id} = '${userId}' \
        `;
        res = await pool.query(q);
        const channelIds = ( res && res.rows && res.rows.length && res.rows[0] && res.rows[0][userWorkspaceDataModel.columnName.channel_ids] ) || [];
        if ( channelIds.length == 0 )   return 0;

        q = `SELECT \
                ${userChannelDataModel.columnName.channel_id}, \
                ${userChannelDataModel.columnName.total_read} \
            FROM ${userChannelDataModel.tableName} \
            WHERE \
                ${userChannelDataModel.columnName.channel_id} = ANY('${postgreUtil.prepareValue(channelIds)}'::UUID[]) AND \
                ${userChannelDataModel.columnName.user_id} = '${userId}' \
        `;
        res = await pool.query(q);
        const userChannelsDataArr = ( res && res.rows && res.rows.length && res.rows ) || [];

        let dataObj = {};
        userChannelsDataArr.map(obj => {
            dataObj[obj[userChannelDataModel.columnName.channel_id]] = {
                totalRead: obj[userChannelDataModel.columnName.total_read]
            };
        })

        let totalUnreadMessages = 0;
        for (let index = 0; index < channelIds.length; index++) {
            const channelId = channelIds[index];
            if ( dataObj[channelId] ) {
                let totalChannelMessages = await getTotalMsgCountOfChannel({channelId});
                totalUnreadMessages += totalChannelMessages - dataObj[channelId]['totalRead'];
            }
        }
        return totalUnreadMessages;
    } catch (error) {
        console.log("Failed query = ", q);
        console.log("Error = ", error);
        throw error;
    }
}

module.exports = {
    getOneChannel,
    createChannel,
    addUserToChannel,
    addMultipleUsersToChannel,
    removeUserFromChannel,
    removeMultipleUsersFromChannel,
    listChannels,
    setLastSeenOfChannel,
    setLastReadOfChannel,
    addBatchToChannel,
    getTotalMsgCountOfChannel,
    setLastSeenOnSocketDisconnection,
    editChannelName,
    addChannelInActiveChannelsSet,
    removeChannelFromActiveChannelsSet,
    getUserChannelDataObj,
    setChannelWritePermissionValue,
    getChannelWritePermissionValue,
    setPinMessage,
    removePinMessage,
    getTotalUnreadMessagesCount,
}
