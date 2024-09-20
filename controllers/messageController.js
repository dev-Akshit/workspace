const { v4: uuidv4 } = require('uuid');
const postgreUtil = require('pg/lib/utils');

const {constants, utils} = require("../lib")
const {redisKeys, redisLockKeys} = constants;

const postgres = require("../config/postgres");
const {pool} = postgres;

const {userModel, workspaceModel, channelModel, messageModel, notificationModel, userChannelDataModel} = require("../models");
const notificationController = require('./notificationController');
const userController = require('./userController');

const redisService = require('../services/redisService');
const channelController = require('./channelController');

const incrTotalMsgCountOfChannelInRedis = async (channelId) => {
    try {
        if ( ! channelId )      throw new Error("ChannelId is null");

        const msgCountKeyName = `${constants.redisKeys.messageCount}:${channelId}`;
        let count = await redisService.redis('incr', msgCountKeyName);
        if ( parseInt(count) !== 1 )     return count;

        let q = `SELECT COUNT(*) \
            FROM ${messageModel.tableName} \
            WHERE ${messageModel.columnName.channel_id} = '${channelId}' \
        `
        let res = await pool.query(q);
        count = ( res && res.rows && res.rows[0] && parseInt(res.rows[0].count) ) || 0;
        count += await redisService.redis('xlen', utils.getChannelMessageRedisStreamName(channelId)) || 0;

        if (count) {
            const isSet = await redisService.redis('setnx', msgCountKeyName, count);
            if (isSet)  redisService.redis('expire', msgCountKeyName, constants.rediskeyExpiryTimesInSec.channelMsgCount);
        }
        return count;
    } catch (error) {
        console.log("Error in incrTotalMsgCountOfChannelInRedis. Error = ", error);
        throw error;
    }
}

const addMessageInRedisStream = async (payload) => {
    try {
        let { workspaceId, channelId, messageId = uuidv4(), userId, content, mentions = [], attachments = [], createdAt = Date.now() } = payload;

        if ( ! workspaceId )        throw new Error("Workspace Id is null");
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! userId )             throw new Error("User Id is null");

        const messageObj = {
            [redisKeys.workspaceId]: workspaceId,
            [redisKeys.channelId]: channelId,
            [redisKeys.messageId]: messageId,
            [redisKeys.userId]: userId,
            [redisKeys.content]: content,
            [redisKeys.createdAt]: createdAt,
            [redisKeys.updatedAt]: createdAt,
            [redisKeys.status]: constants.messageStatus.active,
        }

        if ( mentions.length )      messageObj[redisKeys.mentions] = JSON.stringify(mentions);
        if ( attachments.length )   messageObj[redisKeys.attachments] = JSON.stringify(attachments);

        const messageStreamName = utils.getChannelMessageRedisStreamName(channelId);

        let redisPipeline = global.redisClient.pipeline();
        redisPipeline.xadd(messageStreamName, createdAt, redisKeys.messageId, messageId);
        redisPipeline.hmset(`${redisKeys.messageDataHash}:${messageId}`, messageObj);

        //redisPipeline.incr(`${constants.redisKeys.messageCount}:${channelId}`);
        redisPipeline.hincrby(redisKeys.activeStreamChannelIdsHash, channelId, 1);
        redisPipeline.sadd(redisKeys.activeWorkspaceIdsSet, workspaceId);

        redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, userId), createdAt,
            redisKeys.id, uuidv4(),
            redisKeys.workspaceId, workspaceId,
            redisKeys.channelId, channelId,
            redisKeys.messageId, messageId,
            redisKeys.userId, userId,
            redisKeys.type, constants.userActivityType.addMessage,
            redisKeys.createdAt, createdAt,
        );
        redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${userId}`);

        if ( mentions.length ) {
            let userIdsInMentions = [];
            let valueString = '';
            for (let index = 0; index < mentions.length; index++) {
                let mentionObj = mentions[index];
                let id = mentionObj && mentionObj.id;
                if ( ! id )     throw new Error("UserId is not present in mention");
                if ( id == userId || userIdsInMentions.indexOf(id) != -1 )     continue;

                if ( index != 0 )   valueString += ' , ';
                valueString += ` ( \ 
                    '${workspaceId}', \
                    '${channelId}', \
                    '${id}', \
                    '${messageId}', \
                    '${constants.notificationTypes.mentionType}', \
                    '${userId}' \
                ) `

                userIdsInMentions.push(id);
                redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, id), createdAt,
                    redisKeys.id, uuidv4(),
                    redisKeys.workspaceId, workspaceId,
                    redisKeys.channelId, channelId,
                    redisKeys.messageId, messageId,
                    redisKeys.userId, id,
                    redisKeys.type, constants.userActivityType.mentioned,
                    redisKeys.createdAt, createdAt,
                );
                redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${id}`);
            }
            if ( userIdsInMentions.length ) {
                let q = `INSERT INTO ${notificationModel.tableName} \
                    ( \
                        ${notificationModel.columnName.workspace_id}, \
                        ${notificationModel.columnName.channel_id}, \
                        ${notificationModel.columnName.user_id}, \
                        ${notificationModel.columnName.message_id}, \
                        ${notificationModel.columnName.type}, \
                        ${notificationModel.columnName.created_by} \
                    ) \
                    VALUES ${valueString} \
                `;
                //console.log("q = ", q);
                await pool.query(q);
                
                let notificationObj = {
                    workspaceId, channelId, messageId, type: constants.notificationTypes.mentionType
                }
                notificationController.emitUserNotifications({ userIds: userIdsInMentions, notificationObj});
            }
        }

        await redisPipeline.exec() || [];

        const usersData = await userController.getUsersData([userId]);

        io.to(workspaceId).emit('newMessage', {workspaceId, channelId, messageId, messageObj, usersData});
        incrTotalMsgCountOfChannelInRedis(channelId);

        return {...messageObj, messageId, usersData};

    } catch (error) {
        console.log("Error in addMessageInRedisStream. Error = ", error);
        throw error;
    }
}

const addMessageInDb = async (payload) => {
    try {
        let { workspaceId, channelId, messageId, userId, content, mentions = [], attachments = [], replyIds = [], likedByUserIds = [], unlikedByUserIds = [], deletedBy, deletedAt, isResolved = 0, isDiscussionRequired = 0, notifyUserIds = [], createdAt } = payload;
        if ( ! workspaceId )        throw new Error("Workspace Id is null");
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! messageId )          throw new Error("Message Id is null");
        if ( ! userId )             throw new Error("User Id is null");

        if ( typeof(mentions) == "string" )             mentions = JSON.parse(mentions) || [];
        if ( typeof(attachments) == "string" )          attachments = JSON.parse(attachments) || [];
        if ( typeof(notifyUserIds) == "string" )        notifyUserIds = JSON.parse(notifyUserIds) || [];

        // Insert into message table
        let query1 = `INSERT INTO ${messageModel.tableName} \
            ( \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.workspace_id}, \
                ${messageModel.columnName.channel_id}, \
                ${messageModel.columnName.created_by}, \
                ${messageModel.columnName.content}, \
                ${messageModel.columnName.mentions}, \
                ${messageModel.columnName.attachments}, \
                ${messageModel.columnName.replyIds}, \
                ${messageModel.columnName.liked_by}, \
                ${messageModel.columnName.unliked_by}, \
                ${messageModel.columnName.notify_user_ids}, \
                ${messageModel.columnName.status}, \
                ${messageModel.columnName.deleted_by}, \
                ${messageModel.columnName.deleted_at}, \
                ${messageModel.columnName.is_resolved}, \
                ${messageModel.columnName.is_discussion_required} \
		        ${createdAt ? ( ', ' + messageModel.columnName.created_at + ', ' + messageModel.columnName.updated_at ) : ' '} \
            ) \
            VALUES \
            ( \
                '${messageId}', \
                '${workspaceId}', \
                '${channelId}', \
                '${userId}', \
                $1, \
                '${postgreUtil.prepareValue(mentions)}', \
                '${postgreUtil.prepareValue(attachments)}', \
                '${postgreUtil.prepareValue(replyIds)}', \
                '${postgreUtil.prepareValue(likedByUserIds)}', \
                '${postgreUtil.prepareValue(unlikedByUserIds)}', \
                '${postgreUtil.prepareValue(notifyUserIds)}', \
                ${deletedAt ? constants.messageStatus.deleted : constants.messageStatus.active}, \
                ${deletedBy ? ( "\'" + deletedBy + "\'" ) : 'NULL'}, \
                ${deletedAt || 'NULL'}, \
                ${(isResolved ==true || isResolved == 'true' ) ? true : false}, \
                ${(isDiscussionRequired == true || isDiscussionRequired == 'true') ? true : false} \
		        ${createdAt ? ( ' , ' + createdAt + ' , ' + createdAt ) : ''} \
            ) \
            RETURNING \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.workspace_id}, \
                ${messageModel.columnName.channel_id}, \
                ${messageModel.columnName.content}, \
                ${messageModel.columnName.mentions}, \
                ${messageModel.columnName.attachments}, \
                ${messageModel.columnName.notify_user_ids}, \
                ${messageModel.columnName.deleted_by}, \
                ${messageModel.columnName.deleted_at}, \
                ${messageModel.columnName.is_resolved}, \
                ${messageModel.columnName.is_discussion_required} \
        `;
        //console.log("q1 = ",query1);
        let res1 = await pool.query(query1, [content]);
        messageObj = res1 && res1.rows && res1.rows[0] && res1.rows[0];
        messageId = messageObj && messageObj.id;
        if ( ! messageId )      throw new Error("Message Id is null");

        return {...messageObj, messageId};

    } catch (error) {
        console.log("Error in addMessageInDb. Error = ", error);
        throw error;
    }
}

const editMessage = async (payload) => {
    try {
        const { messageId, userId, content, mentions = [], attachments = [] } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! messageId )          throw new Error("Message Id is null");
        
        let workspaceId, channelId;

        let messageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${messageId}`);
        if ( messageObj && Object.keys(messageObj).length ) {
            let redisUpdateObj = {
                [redisKeys.content]: content,
                [redisKeys.mentions]: JSON.stringify(mentions),
                [redisKeys.attachments]: JSON.stringify(attachments), 
                [redisKeys.status]: constants.messageStatus.edit,
                [redisKeys.updatedAt]: Date.now(),
            };
            await redisService.redis('hmset', `${redisKeys.messageDataHash}:${messageId}`, redisUpdateObj);
            workspaceId = messageObj[redisKeys.workspaceId];
            channelId = messageObj[redisKeys.channelId];
        }
        else {
            let query1 = `UPDATE ${messageModel.tableName} \
                SET ${messageModel.columnName.content} = $1, \
                    ${messageModel.columnName.status} = ${constants.messageStatus.edit}, \
                    ${messageModel.columnName.mentions} = '${postgreUtil.prepareValue(mentions)}', \
                    ${messageModel.columnName.attachments} = '${postgreUtil.prepareValue(attachments)}' \
                WHERE ${messageModel.columnName.id} = '${messageId}' AND ${messageModel.columnName.created_by} = '${userId}' \
                RETURNING \
                    ${messageModel.columnName.workspace_id}, \
                    ${messageModel.columnName.channel_id} \
            `
            //console.log("q1 = ",query1);
            let res = await pool.query(query1, [content]);
            res = (res && res.rows[0]) || {};
            workspaceId = res[messageModel.columnName.workspace_id];
            channelId = res[messageModel.columnName.channel_id];
        }

        if ( mentions.length ) {
            let userIdsInMentions = [];
            let valueString = '';
            for (let index = 0; index < mentions.length; index++) {
                let mentionObj = mentions[index];
                let id = mentionObj && mentionObj.id;
                if ( ! id )     throw new Error("UserId is not present in mention");
                if ( id == userId )     continue;

                if ( index != 0 )   valueString += ' , ';
                valueString += ` ( \ 
                    '${workspaceId}', \
                    '${channelId}', \
                    '${id}', \
                    '${messageId}', \
                    '${constants.notificationTypes.mentionType}', \
                    '${userId}' \
                ) `;

                userIdsInMentions.push(id);
            }
            if ( userIdsInMentions.length ) {
                let q = `INSERT INTO ${notificationModel.tableName} \
                    ( \
                        ${notificationModel.columnName.workspace_id}, \
                        ${notificationModel.columnName.channel_id}, \
                        ${notificationModel.columnName.user_id}, \
                        ${notificationModel.columnName.message_id}, \
                        ${notificationModel.columnName.type}, \
                        ${notificationModel.columnName.created_by} \
                    ) \
                    VALUES ${valueString} \
                `;
                //console.log("q = ", q);
                await pool.query(q);
                
                let notificationObj = {
                    workspaceId, channelId, messageId, type: constants.notificationTypes.mentionType
                }
                notificationController.emitUserNotifications({ userIds: userIdsInMentions, notificationObj});
            }
        }

        io.to(workspaceId).emit('newMessage', {workspaceId, channelId, messageId, isEdit: 1});

        return {msg: "Edited", workspaceId, channelId, messageId, userId};

    } catch (error) {
        console.log("Error in editMessage. Error = ", error);
        throw error;
    }
}

const deleteMessage = async (payload) => {
    let q, res;
    try {
        const { workspaceId, channelId, messageId, userId } = payload;
        if ( ! workspaceId )        throw new Error("Workspace Id is null");
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! messageId )          throw new Error("Message Id is null");
        if ( ! userId )             throw new Error("User Id is null");
        
        let isMessagePresentInRedis = await redisService.redis('exists', `${redisKeys.messageDataHash}:${messageId}`);
        if ( isMessagePresentInRedis ) {
            await redisService.redis('hmset', `${redisKeys.messageDataHash}:${messageId}`, {
                [redisKeys.content]: "",
                [redisKeys.mentions]: JSON.stringify([]),
                [redisKeys.attachments]: JSON.stringify([]),
                [redisKeys.status]: constants.messageStatus.deleted,
                [redisKeys.deletedAt]: Date.now(),
                [redisKeys.deletedBy]: userId,
            })
        }
        else {
            q = `UPDATE ${messageModel.tableName} \
                SET \
                    ${messageModel.columnName.content} = '', \
                    ${messageModel.columnName.mentions} = '${postgreUtil.prepareValue([])}', \
                    ${messageModel.columnName.attachments} = '${postgreUtil.prepareValue([])}', \
                    ${messageModel.columnName.status} = ${constants.messageStatus.deleted}, \
                    ${messageModel.columnName.deleted_at} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000, \
                    ${messageModel.columnName.deleted_by} = '${userId}' \
                WHERE ${messageModel.columnName.id} = '${messageId}' \
                RETURNING \
                    ${messageModel.columnName.id} \
            `;

            //console.log("q1 = ",query1);
            res = await pool.query(q);
            res = res && res.rows && res.rows[0];
            if ( ! ( res && res.id ) )    throw new Error("Deletion failed");
        }

        q = `UPDATE ${channelModel.tableName} \
            SET ${channelModel.columnName.pinned_message_id} = NULL, ${channelModel.columnName.pinned_by} = NULL \
            WHERE ${channelModel.columnName.id} = '${channelId}' AND ${channelModel.columnName.pinned_message_id} = '${messageId}' \
            RETURNING ${channelModel.columnName.pinned_message_id} \
        `;
        res = await pool.query(q);
        let pinMessageId = res && res.rows && res.rows[0] && res.rows[0][channelModel.columnName.pinned_message_id];
        if ( pinMessageId ) {
            io.to(channelId).emit('removePin', {pinMessageId});
        }

        io.to(workspaceId).emit('deleteMessage', {workspaceId, channelId, messageId})
        return {msg: "deleted", workspaceId, channelId, messageId, userId};

    } catch (error) {
        console.log("Error in deleteMessage. Error = ", error);
        throw error;
    }
}

const getMessageIdsArrFromStreamOutputArr = (streamArr = []) => {
    /*
        streamArr =  [["1642842550784-0",["messageId","613a46c6-55a7-4ea1-ad15-a7e4157e1c60"]], ["1642842550787-0",["messageId","613a46c6-55a7-4ea1-ad15-a7e4157e1c61"]]]
    */
    let messageIdsArr = [];
    streamArr.map(item => {
        if (item && item[1] && item[1][0] == redisKeys.messageId && item[1][1])     messageIdsArr.push(item[1][1]);
    })
    return messageIdsArr;
}

const deserializeRedisPipelineMessagesToDbFormat = (pipelineArr = []) => {
    /*
        pipelineArr = [
            [
                null,
                {
                    workspaceId: '2590ad25-1c42-4037-9028-52e07966ff5c',
                    channelId: '99d9c90d-0333-475e-904f-f6c4a8420d74',
                    messageId: '613a46c6-55a7-4ea1-ad15-a7e4157e1c60',
                    userId: '5a14fdbd52795c1b16c0ab9f',
                    content: '4234',
                    createdAt: '1642842550524'
                }
            ],
            [
                null,
                {
                    workspaceId: '2590ad25-1c42-4037-9028-52e07966ff5c',
                    channelId: '99d9c90d-0333-475e-904f-f6c4a8420d74',
                    messageId: '613a46c6-55a7-4ea1-ad15-a7e4157e1c60',
                    userId: '5a14fdbd52795c1b16c0ab9f',
                    content: ':))))), Everything is dying, why are we working ?',
                    createdAt: '1642842550524'
                }
            ]
        ]
    */
    
    let messagesArr = [];
    pipelineArr.map(item => {
        let obj = item && item[1];
        if ( ! obj || Object.keys(obj).length == 0 )     return ;

        let mentions = obj.mentions || [];
        if (typeof(mentions) == "string")   mentions = JSON.parse(mentions);

        let attachments = obj.attachments || [];
        if (typeof(attachments) == "string")   attachments = JSON.parse(attachments);

        let messageObj = {
            [messageModel.columnName.workspace_id]: obj.workspaceId,
            [messageModel.columnName.channel_id]: obj.channelId,
            [messageModel.columnName.id]: obj.messageId,
            [messageModel.columnName.created_by]: obj.userId,
            [messageModel.columnName.replyIds]: obj.replyIds || [],
            [messageModel.columnName.content]: obj.content || '',
            [messageModel.columnName.attachments]: attachments,
            [messageModel.columnName.mentions]: mentions,
            [messageModel.columnName.status]: parseInt(obj.status),
            [messageModel.columnName.notify_user_ids]: [],
            [redisKeys.replyCount]: parseInt(obj.replyCount) || 0,
            [redisKeys.likedByCount]: parseInt(obj.likedByCount) || 0,
            [redisKeys.unlikedByCount]: parseInt(obj.unlikedByCount) || 0,
            [messageModel.columnName.created_at]: parseInt(obj.createdAt),
            [messageModel.columnName.updated_at]: parseInt(obj.updatedAt),
        }

        if (obj.deletedAt) {
            messageObj[messageModel.columnName.deleted_at] = parseInt(obj.deletedAt);
            messageObj[messageModel.columnName.deleted_by] = obj.deletedBy;
        }
        if(obj.isResolved == 'true' || obj.isResolved == true){
            messageObj[messageModel.columnName.is_resolved]= true;
        }
        if(obj.isDiscussionRequired == 'true' || obj.isDiscussionRequired == true){
            messageObj[messageModel.columnName.is_discussion_required] = true;
        }

        if ( obj[redisKeys.notifyUserIds] ) {
            let uIds = obj[redisKeys.notifyUserIds];
            messageObj[messageModel.columnName.notify_user_ids] = typeof(uIds) == "string" ? JSON.parse(uIds) : uIds;
        }

        messagesArr.push(messageObj);
    })
    return messagesArr;
}

const listMessages = async (payload) => {
    try {
        let { userId, workspaceId, channelId, lastSeen, limit, isPrevious, messageId, includeLastSeen } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! workspaceId )        throw new Error("Workspace Id is null");

        limit = parseInt(limit) || constants.defaultMessageCountLimit;
        lastSeen = parseInt(lastSeen);
        let q, isMessagePresentInStream;

        const messageStreamName = utils.getChannelMessageRedisStreamName(channelId);
        const messageStreamLength = await redisService.redis('xlen', messageStreamName);

        // if messageId present, then we check created_at of that message
        if ( messageId ) {
            if ( messageStreamLength ) {
                let messageCreatedAt = await redisService.redis('hget', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.createdAt);
                if ( messageCreatedAt ) {
                    isMessagePresentInStream = true;
                    lastSeen = parseInt(messageCreatedAt);
                }
            }
            if ( ! isMessagePresentInStream ) {
                q = `SELECT ${messageModel.columnName.created_at} \
                    FROM ${messageModel.tableName} \
                    WHERE ${messageModel.columnName.id} = '${messageId}' \
                `;
                let res = await pool.query(q);
                lastSeen = res && res.rows && res.rows[0] && res.rows[0][messageModel.columnName.created_at];
                lastSeen = parseInt(lastSeen);
                if ( ! lastSeen )   throw new Error(`Message not found, Message Id = ${messageId}`);
            }
        }

        let messagesArr = [];
        let dbMessagesArr = [];
        let redisMessagesArr = [];
        let redisMessageIdsArr = [];

        if ( ! lastSeen || isPrevious ) {
            lastSeen = lastSeen || Date.now();
            if (includeLastSeen)      lastSeen += 1;
            if ( messageStreamLength ) {
                let streamData = await redisService.redis('xrevrange', messageStreamName, lastSeen - 1, '-', 'count', limit) || [];
                redisMessageIdsArr = getMessageIdsArrFromStreamOutputArr(streamData);
            }
            limit -= redisMessageIdsArr.length;
            if (limit) {
                q = `SELECT * FROM ${messageModel.tableName} \
                    WHERE ${messageModel.columnName.channel_id} = '${channelId}' AND \
                        ${messageModel.columnName.created_at} < ${lastSeen} AND \
                        ${messageModel.columnName.replyToParentId} IS NULL \
                    ORDER BY ${messageModel.columnName.created_at} DESC \
                    LIMIT ${limit}
                `;
                //console.log("q1 = ",q);
                let res1 = await pool.query(q);
                dbMessagesArr = ( res1 && res1.rows ) || [];
            }
        }
        else {
            if (includeLastSeen)      lastSeen -= 1;
            q = `SELECT * FROM ${messageModel.tableName} \
                WHERE ${messageModel.columnName.channel_id} = '${channelId}' AND \
                    ${messageModel.columnName.created_at} > ${lastSeen} AND \
                    ${messageModel.columnName.replyToParentId} IS NULL \
                    ORDER BY ${messageModel.columnName.created_at} ASC \
                LIMIT ${limit} \
            `;
            //console.log("q1 = ",q);
            let res1 = await pool.query(q);
            dbMessagesArr = ( res1 && res1.rows ) || [];

            limit -= dbMessagesArr.length
            if ( limit && messageStreamLength ) {
                let streamData = await redisService.redis('xrange', messageStreamName, lastSeen + 1, '+', 'count', limit) || [];
                redisMessageIdsArr = getMessageIdsArrFromStreamOutputArr(streamData);
            }
        }

        if ( redisMessageIdsArr.length ) {
            let redisPipeline = global.redisClient.pipeline();
            redisMessageIdsArr.map(id => redisPipeline.hgetall(`${redisKeys.messageDataHash}:${id}`));
            let pipelineOutput = await redisPipeline.exec() || [];
            redisMessagesArr = deserializeRedisPipelineMessagesToDbFormat(pipelineOutput);
        }

        messagesArr = [...dbMessagesArr, ...redisMessagesArr];

        const userIdsSet = new Set();
        messagesArr.map(messageObj => {
            userIdsSet.add(messageObj[messageModel.columnName.created_by]);
            if(messageObj[messageModel.columnName.deleted_by])   userIdsSet.add(messageObj[messageModel.columnName.deleted_by]);
        })

        const usersData = await userController.getUsersData([...userIdsSet]);
        return {messagesArr, usersData};

    } catch (error) {
        console.log("Error in listMessages. Error = ", error);
        throw error;
    }
}

const listMessagesBothSide = async (payload = {}) => {
    try {
        let { userId, workspaceId, channelId, lastRead: lastSeen, limit, messageId } = payload;
        let listMessagePayload = {
            workspaceId,
            channelId,
            isPrevious: 0,
            limit,
            lastSeen,
            includeLastSeen: true,
            userId,
        }

        if (  messageId )   listMessagePayload['messageId'] = messageId;

        let messagesObj = await listMessages(listMessagePayload);

        listMessagePayload.isPrevious = 1;
        delete listMessagePayload.includeLastSeen;
        let messagesObj2 = await listMessages(listMessagePayload);

        return {
            messagesArr: [...messagesObj.messagesArr, ...messagesObj2.messagesArr],
            usersData: {...messagesObj.usersData, ...messagesObj2.usersData},
        }

    } catch (error) {
        console.log("Error in listMessagesBothSide. Error = ", error);
        throw error;
    }
}

const addReply = async (payload = {}) => {
    const client = await pool.connect();
    let isRedisCommandsExecuted = false;
    const { id = uuidv4(), userId, workspaceId, channelId, content, parentIdOfReply, mentions = [], attachments = [], createdAt = Date.now() } = payload;

    try {
        await client.query('BEGIN');

        if ( ! userId )             throw new Error("User Id is null");
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! workspaceId )        throw new Error("Workspace Id is null");
        if ( ! parentIdOfReply )    throw new Error("parentIdOfReply is null");
        
        let redisPipeline = global.redisClient.pipeline();

        // Insert into message table
        let query1 = `INSERT INTO ${messageModel.tableName} \
            ( \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.workspace_id}, \
                ${messageModel.columnName.channel_id}, \
                ${messageModel.columnName.replyToParentId}, \
                ${messageModel.columnName.created_by}, \
                ${messageModel.columnName.content}, \
                ${messageModel.columnName.mentions}, \
                ${messageModel.columnName.attachments}, \
                ${messageModel.columnName.created_at}, \
                ${messageModel.columnName.updated_at} \
            ) \
            VALUES \
            ( \
                '${id}', \
                '${workspaceId}', \
                '${channelId}', \
                '${parentIdOfReply}', \
                '${userId}', \
                $1, \
                '${postgreUtil.prepareValue(mentions)}', \
                '${postgreUtil.prepareValue(attachments)}', \
                ${createdAt}, \
                ${createdAt} \
            ) \
            RETURNING \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.replyToParentId}, \
                ${messageModel.columnName.workspace_id}, \
                ${messageModel.columnName.channel_id}, \
                ${messageModel.columnName.content}, \
                ${messageModel.columnName.mentions}, \
                ${messageModel.columnName.attachments} \
        `;
        //console.log("q1 = ",query1);
        let res1 = await client.query(query1, [content]);
        let messageId = res1 && res1.rows && res1.rows[0] && res1.rows[0].id;
        if ( ! messageId )      throw new Error("Message Id is null");

        let parentMsgCreatorId, parentMessageId, notifyUserIds = [];

        let redisParentMessageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${parentIdOfReply}`);
        if ( redisParentMessageObj && Object.keys(redisParentMessageObj).length ) {
            parentMessageId = redisParentMessageObj.messageId;
            parentMsgCreatorId = redisParentMessageObj.userId;

            await redisService.redis('hincrby', `${redisKeys.messageDataHash}:${parentIdOfReply}`, redisKeys.replyCount, 1);
            redisService.redis('hset', `${redisKeys.messageDataHash}:${parentIdOfReply}`, redisKeys.isResolved, false);

            if ( redisParentMessageObj[redisKeys.notifyUserIds] ) {
                notifyUserIds = redisParentMessageObj[redisKeys.notifyUserIds] || [];
                if ( typeof(notifyUserIds) == "string" )     notifyUserIds = JSON.parse(notifyUserIds);
            }
            isRedisCommandsExecuted = true;
        }
        else {
            // Add replyMessageId to parent message document
            let q2 = `UPDATE ${messageModel.tableName} \
                SET \
                    ${messageModel.columnName.replyIds} = ARRAY_APPEND(${messageModel.columnName.replyIds}, '${messageId}'), \
                    ${messageModel.columnName.is_resolved} = false \
                WHERE ${messageModel.columnName.id} = '${parentIdOfReply}' \
                RETURNING ${messageModel.columnName.id}, ${messageModel.columnName.created_by}, ${messageModel.columnName.replyIds}, ${messageModel.columnName.notify_user_ids} \
            `
            //console.log("q2 = ",q2);
            let res2 = await client.query(q2);
            let parentMessageObj = res2 && res2.rows && res2.rows[0] && res2.rows[0];
            parentMessageId = parentMessageObj.id;
            if ( ! parentMessageId )   throw new Error("ParentMessageId of reply is not valid");

            parentMsgCreatorId = parentMessageObj.created_by;
            notifyUserIds = parentMessageObj[messageModel.columnName.notify_user_ids] || [];
        }

        if ( notifyUserIds.indexOf(parentMsgCreatorId) == -1 )  notifyUserIds.push(parentMsgCreatorId);

        if ( notifyUserIds.length ) {
            let curUserIdIndex = notifyUserIds.indexOf(userId);
            if ( curUserIdIndex != -1 )     notifyUserIds.splice(curUserIdIndex, 1);

            for (let i = 0; i < notifyUserIds.length; i++) {
                // Add notification of above message
                if ( notifyUserIds[i] == userId )   continue; 
                let q3 = `INSERT INTO ${notificationModel.tableName} \
                    ( \
                        ${notificationModel.columnName.workspace_id}, \
                        ${notificationModel.columnName.channel_id}, \
                        ${notificationModel.columnName.user_id}, \
                        ${notificationModel.columnName.message_id}, \
                        ${notificationModel.columnName.reply_id}, \
                        ${notificationModel.columnName.type}, \
                        ${notificationModel.columnName.created_by} \
                    ) \
                    VALUES \
                    ( \
                        '${workspaceId}', \
                        '${channelId}', \
                        '${notifyUserIds[i]}', \
                        '${parentMessageId}', \
                        '${messageId}', \
                        '${constants.notificationTypes.replyType}', \
                        '${userId}' \
                    ) \
                `;

                //console.log("q3 = ", q3);
                await client.query(q3);
            }
        }

        if ( mentions.length ) {
            let userIdsInMentions = [];
            let valueString = '';
            for (let index = 0; index < mentions.length; index++) {
                let mentionObj = mentions[index];
                let id = mentionObj && mentionObj.id;
                if ( ! id )     throw new Error("UserId is not present in mention");
                if ( id == userId || userIdsInMentions.indexOf(id) != -1 )     continue;

                if ( index != 0 )   valueString += ' , ';
                valueString += ` ( \ 
                    '${workspaceId}', \
                    '${channelId}', \
                    '${id}', \
                    '${parentMessageId}', \
                    '${messageId}', \
                    '${constants.notificationTypes.mentionType}', \
                    '${userId}' \
                ) `

                userIdsInMentions.push(id);

                redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, id), createdAt,
                    redisKeys.id, uuidv4(),
                    redisKeys.workspaceId, workspaceId,
                    redisKeys.channelId, channelId,
                    redisKeys.messageId, parentMessageId,
                    redisKeys.replyId, messageId,
                    redisKeys.userId, id,
                    redisKeys.type, constants.userActivityType.mentionedInReply,
                    redisKeys.createdAt, createdAt,
                );
                redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${id}`);
            }

            if ( userIdsInMentions.length ) {
                let q4 = `INSERT INTO ${notificationModel.tableName} \
                    ( \
                        ${notificationModel.columnName.workspace_id}, \
                        ${notificationModel.columnName.channel_id}, \
                        ${notificationModel.columnName.user_id}, \
                        ${notificationModel.columnName.message_id}, \
                        ${notificationModel.columnName.reply_id}, \
                        ${notificationModel.columnName.type}, \
                        ${notificationModel.columnName.created_by} \
                    ) \
                    VALUES ${valueString} \
                `;
                await client.query(q4);
                
                let notificationObj = {
                    workspaceId, channelId, messageId, type: constants.notificationTypes.mentionType
                }
                notificationController.emitUserNotifications({ userIds: userIdsInMentions, notificationObj});
            }
        }

        await client.query('COMMIT');

        if ( notifyUserIds.length ) {
            let notificationObj = {
                workspaceId, channelId, 'messageId': parentMessageId, 'replyId': messageId, type: constants.notificationTypes.replyType
            }
            notificationController.emitUserNotifications({ userIds: notifyUserIds, notificationObj});
        }
        
        redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, userId), createdAt,
            redisKeys.id, uuidv4(),
            redisKeys.workspaceId, workspaceId,
            redisKeys.channelId, channelId,
            redisKeys.messageId, parentMessageId,
            redisKeys.replyId, messageId,
            redisKeys.userId, userId,
            redisKeys.type, constants.userActivityType.addReply,
            redisKeys.createdAt, createdAt,
        );
        redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${userId}`);

        await redisPipeline.exec();
        await client.release();

        const usersData = await userController.getUsersData([userId]);
        return {messageId, usersData};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();

        if ( isRedisCommandsExecuted ) {
            redisService.redis('hincrby', `${redisKeys.messageDataHash}:${parentIdOfReply}`, redisKeys.replyCount, -1);
        }

        console.log("Error in addReply. Error = ", error);
        throw error;
    }
}

const editReply = async (payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { messageId, userId, content,mentions = [], attachments = [] } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! messageId )          throw new Error("Message Id is null");
        
        let query1 = `UPDATE ${messageModel.tableName} \
            SET ${messageModel.columnName.content} = $1, \
                ${messageModel.columnName.status} = ${constants.replyEventType.editType}, \
                ${messageModel.columnName.mentions} = '${postgreUtil.prepareValue(mentions)}', \
                ${messageModel.columnName.attachments} = '${postgreUtil.prepareValue(attachments)}' \
            WHERE ${messageModel.columnName.id} = '${messageId}' AND ${messageModel.columnName.created_by} = '${userId}' \
        `
        console.log("q1 = ",query1);
        let res1 = await client.query(query1, [content]);

        await client.query('COMMIT');
        await client.release();
        
        return {msg: "Edited"};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in editReply. Error = ", error);
        throw error;
    }
}

const deleteReply = async (payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { messageId, userId } = payload;
        if ( ! userId )             throw new Error("User Id is null");
        if ( ! messageId )          throw new Error("Message Id is null");
        
        let query1 = `UPDATE ${messageModel.tableName} \
            SET \
                ${messageModel.columnName.status} = ${constants.replyEventType.deleteType}, \
                ${messageModel.columnName.deleted_at} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000, \
                ${messageModel.columnName.deleted_by} = '${userId}' \
            WHERE ${messageModel.columnName.id} = '${messageId}' \
            RETURNING \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.workspace_id}, \
                ${messageModel.columnName.channel_id} \
        `

        //console.log("q1 = ",query1);
        let res1 = await client.query(query1);

        res1 = res1 && res1.rows && res1.rows[0];
        if ( ! ( res1 && res1.id ) )    throw new Error("Deletion failed");

        let { workspace_id: workspaceId, channel_id: channelId } = res1;

        await client.query('COMMIT');
        await client.release();
        
        io.to(workspaceId).emit('deleteReply', {workspaceId, channelId, messageId})
        return {msg: "deleted"};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in deleteReply. Error = ", error);
        throw error;
    }
}

const listReplies = async (payload) => {
    try {
        const { channelId, workspaceId, parentIdOfReply } = payload;
        if ( ! channelId )          throw new Error("Channel Id is null");
        if ( ! workspaceId )        throw new Error("Workspace Id is null");
        if ( ! parentIdOfReply )    throw new Error("parentIdOfReply is null");

        // const query1 = `select * \
        //     FROM ${messageModel.tableName} \
        //     WHERE ${messageModel.columnName.id} = ANY(ARRAY(\
        //         SELECT ${messageModel.columnName.replyIds} \
        //         FROM ${messageModel.tableName} \
        //         WHERE ${messageModel.columnName.id} = '${parentIdOfReply}' \
        //     ));`

        const query1 = `select * \
            FROM ${messageModel.tableName} \
            WHERE \
                ${messageModel.columnName.channel_id} = '${channelId}' AND \
                ${messageModel.columnName.replyToParentId} = '${parentIdOfReply}' \
            ORDER BY ${messageModel.columnName.created_at} ASC \
        `;

        //console.log("q1 = ", query1);
        let res1 = await pool.query(query1);
        let repliesArr = ( res1 && res1.rows ) || [];

        const userIdsSet = new Set();
        repliesArr.map(messageObj => {
            userIdsSet.add(messageObj[messageModel.columnName.created_by]);
        })

        const usersData = await userController.getUsersData([...userIdsSet]);

        return {repliesArr, usersData};

    } catch (error) {
        console.log("Error in listReplies. Error = ", error);
        throw error;
    }
}

const popMessageIdFromStream = async (channelId) => {
    try {
        if ( ! channelId )  throw new Error("ChannelId is null");

        const messageStreamName = utils.getChannelMessageRedisStreamName(channelId)
        const streamData = await redisService.redis('xrange', messageStreamName, '-', '+', 'count', 1);
        
        const messageIdsArr = getMessageIdsArrFromStreamOutputArr(streamData);
	    if ( messageIdsArr.length == 0 )	return ;
        if ( messageIdsArr.length != 1 )    throw new Error("More than one messages are coming from stream");
        
        const streamObjId = streamData && streamData[0] && streamData[0][0];
        //console.log("streamObjId = ", streamObjId);

        const messageId = messageIdsArr[0];
        const messageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${messageId}`);
        if ( ! messageObj || Object.keys(messageObj).length == 0 )  throw new Error(`Message id = ${messageId}, not found in redis`);

        if ( messageObj.replyCount ) {
            const query1 = `SELECT \
                ${messageModel.columnName.id}, \
                ${messageModel.columnName.created_at} \
            FROM ${messageModel.tableName} \
            WHERE \
                ${messageModel.columnName.channel_id} = '${channelId}' AND \ 
                ${messageModel.columnName.replyToParentId} = '${messageId}' \
            ORDER BY ${messageModel.columnName.created_at} ASC \
            `
            //console.log("q1 = ", query1);
            let res1 = await pool.query(query1);
            messageObj.replyIds = ( ( res1 && res1.rows  ) || [] ).map(replyObj => replyObj[messageModel.columnName.id]);
            if ( messageObj.replyIds.length == 0 )   throw new Error(`Replies not found, Reply count is ${replyCount}`);
        }

        if ( parseInt(messageObj[redisKeys.likedByCount]) ) {
            messageObj.likedByUserIds = await redisService.redis('smembers', `${redisKeys.likedByUserIdsSet}:${messageId}`) || [];
        }

        if ( parseInt(messageObj[redisKeys.unlikedByCount]) ) {
            messageObj.unlikedByUserIds = await redisService.redis('smembers', `${redisKeys.unlikedByUserIdsSet}:${messageId}`) || [];
        }
        
        await addMessageInDb(messageObj);
        await redisService.redis('xdel', messageStreamName, streamObjId);
        await redisService.redis('del', `${redisKeys.messageDataHash}:${messageId}`, `${redisKeys.likedByUserIdsSet}:${messageId}`, `${redisKeys.unlikedByUserIdsSet}:${messageId}`);

        console.log(`Message Id = ${messageId} written to Db`);
        return ;

    } catch (error) {
        console.log("popMessageIdFromStream, Error = ", error);
        throw new Error(error.message);
    }
}

const getChannelIdForMessageWriteToDb = async () => {
    try {
        const isMessageWritePaused = await redisService.redis('get', redisKeys.pauseDbWrite);
        if ( parseInt(isMessageWritePaused) )     return ;

        const isLockAvailable = await utils.lockRedis(redisLockKeys.streamKey);
        if ( ! isLockAvailable )    return ;

        const channelIdsObj = await redisService.redis('hgetall', redisKeys.activeStreamChannelIdsHash) || {};
        const channelIds = Object.keys(channelIdsObj);
        for (let index = 0; index < channelIds.length; index++) {
            const channelId = channelIds[index];

            let sockets = await io.in(channelId).fetchSockets();
            //console.log(`Socket length for channel ${channelId} is ${sockets.length}`);
            if (sockets.length)     continue;

            let streamCount = parseInt(channelIdsObj[channelId]);
            if (streamCount > 0) {
                await popMessageIdFromStream(channelId);
                streamCount = await redisService.redis('hincrby', redisKeys.activeStreamChannelIdsHash, channelId, -1);
                streamCount = parseInt(streamCount);
            }
            
            if ( ! streamCount || streamCount <= 0)     await redisService.redis('hdel', redisKeys.activeStreamChannelIdsHash, channelId);
        }
        utils.unlockRedis(redisLockKeys.streamKey);
        return ;
    } catch (error) {
        console.log("getChannelIdForMessageWriteToDb, Error = ", error);
        utils.unlockRedis(redisLockKeys.streamKey);
        return ;
    }
}

const getMessageStreamsLengthOfAllChannels = async () => {
    try {
        let dataObj = await redisService.redis('hgetall', redisKeys.activeStreamChannelIdsHash) || {};
        return dataObj;
    } catch (error) {
        throw new Error(error.message);
    }
}

const setIsResolvedOfMessage = async function (payload = {}) {
    try {
        //isResolved should be either 0 or 1.
        const { workspaceId, channelId, messageId, userId, isResolved, createdAt = Date.now() } = payload;
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! channelId )      throw new Error("channelId is null");
        if ( ! messageId )      throw new Error("messageId is null");
        if ( ! userId )         throw new Error("userId is null");
        // if ( ! Object(payload).hasOwnProperty(isResolved) )     throw new Error("isResolved not found");

        let redisPipeline = global.redisClient.pipeline();
        
        let messageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${messageId}`);
        if ( messageObj && Object.keys(messageObj).length ) {
            await redisService.redis('hset', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.isResolved, isResolved);
        }
        else {
            const q = `UPDATE ${messageModel.tableName} \
                SET ${messageModel.columnName.is_resolved} = ${isResolved} \
                WHERE ${messageModel.columnName.id} = '${messageId}' \
            `
            await pool.query(q);
        }
        
        const createdBy = messageObj?.userId;

        if(createdBy !== userId){
            redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, userId), createdAt,
                redisKeys.id, uuidv4(),
                redisKeys.workspaceId, workspaceId,
                redisKeys.channelId, channelId,
                redisKeys.messageId, messageId,
                redisKeys.userId, userId,
                redisKeys.type, constants.userActivityType.resolved,
                redisKeys.createdAt, createdAt,
            );
            redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${userId}`);
        }
        
        redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, createdBy), createdAt,
            redisKeys.id, uuidv4(),
            redisKeys.workspaceId, workspaceId,
            redisKeys.channelId, channelId,
            redisKeys.messageId, messageId,
            redisKeys.userId, createdBy,
            redisKeys.type, constants.userActivityType.resolved,
            redisKeys.createdAt, createdAt,
        );
        redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${userId}`);
        
        await redisPipeline.exec();
        
        io.to(channelId).emit('isResolved', payload);
        
        return {msg: 'isResolved updated successfully'};
        
    } catch (error) {
        console.log("Error in setIsResolvedOfMessage. ", error);
        throw error;
    }
}

const setIsDiscussionRequiredOfMessage = async function (payload = {}) {
    try {
        //isResolved should be either 0 or 1.
        const { workspaceId, channelId, messageId, userId, isDiscussionRequired, createdAt = Date.now() } = payload;
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! channelId )      throw new Error("channelId is null");
        if ( ! messageId )      throw new Error("messageId is null");
        if ( ! userId )         throw new Error("userId is null");
        // if ( ! Object(payload).hasOwnProperty(isResolved) )     throw new Error("isResolved not found");
        let redisPipeline = global.redisClient.pipeline();

        let messageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${messageId}`);
        if ( messageObj && Object.keys(messageObj).length) {
            await redisService.redis('hset', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.isDiscussionRequired, isDiscussionRequired);
        }
        else {
            const q = `UPDATE ${messageModel.tableName} \
                SET ${messageModel.columnName.is_discussion_required} = ${isDiscussionRequired} \
                WHERE ${messageModel.columnName.id} = '${messageId}' \
            `
            await pool.query(q);
        }

        redisPipeline.xadd(utils.getUserActivityRedisStreamName(workspaceId, userId), createdAt,
            redisKeys.id, uuidv4(),
            redisKeys.workspaceId, workspaceId,
            redisKeys.channelId, channelId,
            redisKeys.messageId, messageId,
            redisKeys.userId, userId,
            redisKeys.type, constants.userActivityType.toDiscuss,
            redisKeys.createdAt, createdAt,
        );
        redisPipeline.sadd(redisKeys.activeUsersActivityStreamSet, `${workspaceId}:${userId}`);

        await redisPipeline.exec();
                
        io.to(channelId).emit('isDiscussionRequired', payload);

        return {msg: 'isDiscussionRequired updated successfully'};
        
    } catch (error) {
        console.log("Error in setIsDiscussionRequiredOfMessage. ", error);
        throw error;
    }
}

const updateLikedBy = async function (payload = {}) {
    try {
        const { workspaceId, channelId, messageId, userId, isLiked } = payload;
        const likedBy = payload.userId;
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! channelId )      throw new Error("channelId is null");
        if ( ! messageId )      throw new Error("messageId is null");
        if ( ! userId )         throw new Error("userId is null");
        if ( ! likedBy )        throw new Error("likedBy is null");
        // if ( ! Object(payload).hasOwnProperty(isLiked) )     throw new Error("isLiked not found");

        let q, res, isUnlikedCurrently, contributionScore = 0, isHappen;
        let createdBy = await redisService.redis('hget', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.userId);
        if ( createdBy ) {
            isUnlikedCurrently = await redisService.redis('sismember', `${redisKeys.unlikedByUserIdsSet}:${messageId}`, userId);

            if ( isLiked ) {
                isHappen = await redisService.redis('sadd', `${redisKeys.likedByUserIdsSet}:${messageId}`, userId);
                if ( isHappen ) {
                    redisService.redis('hincrby', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.likedByCount, 1);
                    contributionScore = 1 + ( isUnlikedCurrently ? 1 : 0 );
                }
            }
            else if ( ! isUnlikedCurrently ) {
                const isAlreadyLiked = await redisService.redis('sismember', `${redisKeys.likedByUserIdsSet}:${messageId}`, userId);
                if ( isAlreadyLiked ) {
                    isHappen = await redisService.redis('srem', `${redisKeys.likedByUserIdsSet}:${messageId}`, userId);
                    if ( isHappen ) {
                        redisService.redis('hincrby', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.likedByCount, -1);
                        contributionScore = -1;
                    }
                }
            }
            else {}
        }
        else {
            q = `SELECT ${messageModel.columnName.id} FROM ${messageModel.tableName} \
                WHERE \
                    ${messageModel.columnName.id} = '${messageId}' AND \
                    ${messageModel.columnName.unliked_by} @> ARRAY['${userId}']::VARCHAR(100)[] \
                `;
            res = await pool.query(q);
            isUnlikedCurrently = res && res.rows && res.rows.length && res.rows[0] && res.rows[0].id;

            if (isLiked) {
                q = `UPDATE ${messageModel.tableName} \
                    SET \
                        ${messageModel.columnName.liked_by} = ARRAY_APPEND(${messageModel.columnName.liked_by}, '${userId}') \
                    WHERE \
                        ${messageModel.columnName.id} = '${messageId}' AND \
                        NOT ( ${messageModel.columnName.liked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) AND \
                        NOT ( ${messageModel.columnName.unliked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
                    RETURNING ${messageModel.columnName.id}, ${messageModel.columnName.created_by} \
                `;
                res = await pool.query(q);
                res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
                let id = res[messageModel.columnName.id];
                createdBy = res[messageModel.columnName.created_by];
                isHappen = Boolean(id);
                if ( isHappen ) {
                    contributionScore = 1 + ( isUnlikedCurrently ? 1 : 0 );
                }
            }
            else if ( ! isUnlikedCurrently ) {
                q = `UPDATE ${messageModel.tableName} \
                    SET \
                        ${messageModel.columnName.liked_by} = ARRAY_REMOVE(${messageModel.columnName.liked_by}, '${userId}') \
                    WHERE \
                        ${messageModel.columnName.id} = '${messageId}' AND \
                        ${messageModel.columnName.liked_by} @> ARRAY['${userId}']::VARCHAR(100)[] AND \
                        NOT ( ${messageModel.columnName.unliked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
                    RETURNING ${messageModel.columnName.id}, ${messageModel.columnName.created_by} \
                `;
                res = await pool.query(q);
                res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
                let id = res[messageModel.columnName.id];
                createdBy = res[messageModel.columnName.created_by];
                isHappen = Boolean(id);
                if ( isHappen ) {
                    contributionScore = -1;
                }
            }
        }

        if ( isHappen ) {
            q = `UPDATE ${userChannelDataModel.tableName} \
                SET \
                    ${userChannelDataModel.columnName.liked_message_ids} = ${ isLiked ? 'ARRAY_APPEND': 'ARRAY_REMOVE'}(${userChannelDataModel.columnName.liked_message_ids}, '${messageId}') \
                WHERE \
                    ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                    ${userChannelDataModel.columnName.user_id} = '${userId}' \
            `;
            await pool.query(q);
            await redisService.redis('del', `${redisKeys.userChannelDataHash}:${userId}`);

            if ( createdBy && contributionScore) {
                // query to update contributor score
                q = `UPDATE ${userChannelDataModel.tableName} \
                    SET ${userChannelDataModel.columnName.contributor_score} = ${userChannelDataModel.columnName.contributor_score} + ${contributionScore} \
                    WHERE \
                        ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                        ${userChannelDataModel.columnName.user_id} = '${createdBy}' \
                `;
                await pool.query(q);
                redisService.redis('del', `${redisKeys.userChannelDataHash}:${createdBy}`);
            }
        }

        // EMIT SOCKET EVENT
        io.to(channelId).emit('likeMessage', payload);
        return {msg: 'updateLikedBy updated successfully'};
        
    } catch (error) {
        console.log("Error in updateLikedBy. ", error);
        throw error;
    }
}

const updateUnlikedBy = async function (payload = {}) {
    try {
        const { workspaceId, channelId, messageId, userId, isUnliked } = payload;
        const unlikedBy = payload.userId;
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! channelId )      throw new Error("channelId is null");
        if ( ! messageId )      throw new Error("messageId is null");
        if ( ! userId )         throw new Error("userId is null");
        if ( ! unlikedBy )        throw new Error("unlikedBy is null");
        // if ( ! Object(payload).hasOwnProperty(isUnliked) )     throw new Error("isUnliked not found");

        let q, res, isLikedCurrently, contributionScore = 0, isHappen;
        let createdBy = await redisService.redis('hget', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.userId);
        if ( createdBy ) {
            isLikedCurrently = await redisService.redis('sismember', `${redisKeys.likedByUserIdsSet}:${messageId}`, userId);

            if ( isUnliked ) {
                isHappen = await redisService.redis('sadd', `${redisKeys.unlikedByUserIdsSet}:${messageId}`, userId);
                if ( isHappen ) {
                    redisService.redis('hincrby', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.unlikedByCount, 1);
                    contributionScore = -1 + ( isLikedCurrently ? -1 : 0 );
                }
            }
            else if ( ! isLikedCurrently ) {
                const isAlreadyUnliked = await redisService.redis('sismember', `${redisKeys.unlikedByUserIdsSet}:${messageId}`, userId);
                if ( isAlreadyUnliked ) {
                    isHappen = await redisService.redis('srem', `${redisKeys.unlikedByUserIdsSet}:${messageId}`, userId);
                    if ( isHappen ) {
                        redisService.redis('hincrby', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.unlikedByCount, -1);
                        contributionScore = 1;
                    }
                }
            }
            else {}
        }
        else {
            q = `SELECT ${messageModel.columnName.id} FROM ${messageModel.tableName} \
                WHERE \
                    ${messageModel.columnName.id} = '${messageId}' AND \
                    ${messageModel.columnName.liked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
                `;
            res = await pool.query(q);
            isLikedCurrently = res && res.rows && res.rows.length && res.rows[0] && res.rows[0].id;

            if (isUnliked) {
                q = `UPDATE ${messageModel.tableName} \
                    SET \
                        ${messageModel.columnName.unliked_by} = ARRAY_APPEND(${messageModel.columnName.unliked_by}, '${userId}') \
                    WHERE \
                        ${messageModel.columnName.id} = '${messageId}' AND \
                        NOT ( ${messageModel.columnName.liked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) AND \
                        NOT ( ${messageModel.columnName.unliked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
                    RETURNING ${messageModel.columnName.id}, ${messageModel.columnName.created_by} \
                `;
                res = await pool.query(q);
                res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
                let id = res[messageModel.columnName.id];
                createdBy = res[messageModel.columnName.created_by];
                isHappen = Boolean(id);
                if ( isHappen ) {
                    contributionScore = -1 + ( isUnlikedCurrently ? -1 : 0 );
                }
            }
            else if ( ! isLikedCurrently ) {
                q = `UPDATE ${messageModel.tableName} \
                    SET \
                        ${messageModel.columnName.unliked_by} = ARRAY_REMOVE(${messageModel.columnName.unliked_by}, '${userId}') \
                    WHERE \
                        ${messageModel.columnName.id} = '${messageId}' AND \
                        ${messageModel.columnName.unliked_by} @> ARRAY['${userId}']::VARCHAR(100)[] AND \
                        NOT ( ${messageModel.columnName.liked_by} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
                    RETURNING ${messageModel.columnName.id}, ${messageModel.columnName.created_by} \
                `;
                res = await pool.query(q);
                res = ( res && res.rows && res.rows.length && res.rows[0] ) || {};
                let id = res[messageModel.columnName.id];
                createdBy = res[messageModel.columnName.created_by];
                isHappen = Boolean(id);
                if ( isHappen ) {
                    contributionScore = 1;
                }
            }
        }

        if ( isHappen ) {
            q = `UPDATE ${userChannelDataModel.tableName} \
                SET \
                    ${userChannelDataModel.columnName.unliked_message_ids} = ${ isLiked ? 'ARRAY_APPEND': 'ARRAY_REMOVE'}(${userChannelDataModel.columnName.unliked_message_ids}, '${messageId}') \
                WHERE \
                    ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                    ${userChannelDataModel.columnName.user_id} = '${userId}' \
            `;
            await pool.query(q);
            await redisService.redis('del', `${redisKeys.userChannelDataHash}:${userId}`);

            if ( createdBy && contributionScore) {
                // query to update contributor score
                q = `UPDATE ${userChannelDataModel.tableName} \
                    SET ${userChannelDataModel.columnName.contributor_score} = ${userChannelDataModel.columnName.contributor_score} + ${contributionScore} \
                    WHERE \
                        ${userChannelDataModel.columnName.channel_id} = '${channelId}' AND \
                        ${userChannelDataModel.columnName.user_id} = '${createdBy}' \
                `;
                await pool.query(q);
                redisService.redis('del', `${redisKeys.userChannelDataHash}:${createdBy}`);
            }
        }

        // EMIT SOCKET EVENT
        io.to(channelId).emit('unLikeMessage', payload);
        return {msg: 'updateUnLikedBy updated successfully'};
        
    } catch (error) {
        console.log("Error in updateUnLikedBy. ", error);
        throw error;
    }
}

const updateNotifyUsersListOfMessage = async function (payload = {}) {
    try {
        const { workspaceId, channelId, messageId, userId, isNotify } = payload;
        if ( ! workspaceId )    throw new Error("WorkspaceId is null");
        if ( ! channelId )      throw new Error("channelId is null");
        if ( ! messageId )      throw new Error("messageId is null");
        if ( ! userId )         throw new Error("userId is null");
        // if ( ! Object(payload).hasOwnProperty(isResolved) )     throw new Error("isResolved not found");

        let messageObj = await redisService.redis('hgetall', `${redisKeys.messageDataHash}:${messageId}`);
        if ( messageObj && Object.keys(messageObj).length ) {
            let notifyUsersList = messageObj[redisKeys.notifyUserIds] || [];
            if(typeof notifyUsersList === 'string'){
                notifyUsersList = JSON.parse(notifyUsersList);
            }
            let isAlreadyAdded = notifyUsersList.indexOf(userId) != -1;
            if ( isNotify ) {
                if ( isAlreadyAdded )       throw new Error("Already added in notify users list");
                notifyUsersList.push(userId);
            }
            else {
                if ( ! isAlreadyAdded )     throw new Error("Not in notify users list");
                notifyUsersList.splice(notifyUsersList.indexOf(userId), 1);
            }
            await redisService.redis('hset', `${redisKeys.messageDataHash}:${messageId}`, redisKeys.notifyUserIds, JSON.stringify(notifyUsersList));
        }
        else {
            const q = `UPDATE ${messageModel.tableName} \
                SET \
                    ${messageModel.columnName.notify_user_ids} = ${isNotify ? 'ARRAY_APPEND' : 'ARRAY_REMOVE'}(${messageModel.columnName.notify_user_ids}, '${userId}') \
                WHERE \
                    ${messageModel.columnName.id} = '${messageId}' AND \
                    ${isNotify ? 'NOT' : ''} ( ${messageModel.columnName.notify_user_ids} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
            `
            await pool.query(q);
        }

        io.to(channelId).emit('updateNotifyUsersListOfMessage', payload);
        return {msg: 'notifyUsersList updated successfully'};
    } catch (error) {
        console.log("Error in updateNotifyUsersListOfMessage. ", error);
        throw error;
    }
}

const getMessagesDataFromIds = async (messageIds = []) => {
    const messagesObj = {}
    if ( messageIds.length == 0 )   return messagesObj;
    
    const redisPipeline = global.redisClient.pipeline();
    messageIds.map(id => redisPipeline.hgetall(`${redisKeys.messageDataHash}:${id}`));
    const pipelineOutput = await redisPipeline.exec() || [];
    const redisMessagesArr = deserializeRedisPipelineMessagesToDbFormat(pipelineOutput) || [];
    redisMessagesArr.map(obj => {
        if ( ! obj.id )     return ;
        utils.changeObjectKeysToCamelCase(obj);
        messagesObj[obj.id] = obj;
        messageIds.splice(messageIds.indexOf(obj.id), 1);
    })

    const q = `SELECT * FROM ${messageModel.tableName} WHERE ${messageModel.columnName.id} = ANY('${postgreUtil.prepareValue(messageIds)}'::UUID[])`;
    let res = await pool.query(q);
    res = ( res && res.rows ) || [];
    res.map(obj => {
        utils.changeObjectKeysToCamelCase(obj);
        messagesObj[obj.id] = obj;
    })
    return messagesObj;
}

const startMessageWriteInterval = function() {
    setInterval( () => {
        getChannelIdForMessageWriteToDb();
    }, 1000);
}

module.exports = {
    addMessageInRedisStream,
    addMessageInDb,
    editMessage,
    deleteMessage,
    listMessages,
    listMessagesBothSide,
    addReply,
    editReply,
    deleteReply,
    listReplies,
    popMessageIdFromStream,
    startMessageWriteInterval,
    getMessageStreamsLengthOfAllChannels,
    setIsResolvedOfMessage,
    setIsDiscussionRequiredOfMessage,
    updateLikedBy,
    updateUnlikedBy,
    updateNotifyUsersListOfMessage,
    getMessagesDataFromIds,
}
