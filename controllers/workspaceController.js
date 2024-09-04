const { v4: uuidv4 } = require('uuid');
const postgreUtil = require('pg/lib/utils');

const constants = require('../lib/constants');
const {redisKeys} = constants;

const postgres = require("../config/postgres");
const {pool} = postgres;

const {userModel, workspaceModel,notificationModel, userWorkspaceDataModel} = require("../models");

const channelController = require('./channelController');
const messageController = require('./messageController');
const notificationController = require('./notificationController');
const userController = require('./userController');

const {cqBackendUrl} = require("../config/configVars");
const axios = require('axios');

const createWorkSpace = async (payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { name, userId, type = constants.workSpaceTypes.basicType, courseId = '' } = payload;
        if ( ! userId )     throw new Error("UserId is null");
        if ( type == constants.workSpaceTypes.courseType && ! courseId )    throw new Error("Type is of Course but courseId is null");
        // Insert into workspace table
        let query1 = `INSERT INTO ${workspaceModel.tableName} \
            ( \
                ${workspaceModel.columnName.name}, \
                ${workspaceModel.columnName.type}, \
                ${workspaceModel.columnName.created_by}, \
                ${workspaceModel.columnName.course_id}
            ) \
            VALUES \
            ( \
                '${name}', \
                ${type}, \
                '${userId}', \
                '${courseId}'
            ) \
            RETURNING ${workspaceModel.columnName.id} \
        `;
        //console.log("q1 = ",query1);
        let res1 = await client.query(query1);
        let workspaceId = res1 && res1.rows && res1.rows.length && res1.rows[0] && res1.rows[0].id;
        if ( ! workspaceId )    throw new Error("Workspace Id is null");
        //console.log("Workspace Id = ", workspaceId);
        
        // Query to add userId in workspace document
        let query2 = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.workspace_ids} = ARRAY_APPEND(${userModel.columnName.workspace_ids}, '${workspaceId}') \
            WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.workspace_ids} @> ARRAY['${workspaceId}']::UUID[] ) \
        `
        //console.log("q2 = ",query2);
        let res2 = await client.query(query2);

        if ( type == constants.workSpaceTypes.courseType ) {
            let res3 = await axios.post(`${cqBackendUrl}${constants.cqBackendRoutes.addWorkspaceInCourse}`,{workspaceId, courseId, accessKey: constants.workspaceBackendKey});
            let data = res3 && res3.data;
            //if ( ! data || data.error )     throw new Error(`${ ( data && data.error ) ? data.error : 'Error in setting workspaceId in course'}`);
        }

        await client.query('COMMIT');
        await client.release();
        
        return {'workspaceId': workspaceId};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in createWorkSpace. Error = ", error);
        throw error;
    }
}

const editWorkSpace = async (payload) => {
    try {
        let { workspaceId, name } = payload;
        if ( ! workspaceId )     throw new Error("WorkspaceId is null");
        if ( ! name )            throw new Error("Name is null");

        let q = `UPDATE ${workspaceModel.tableName} \
            SET ${workspaceModel.columnName.name} = '${name}' \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' \
            RETURNING ${workspaceModel.columnName.id} \
        `;
        
        let res1 = await pool.query(q);
        workspaceId = res1 && res1.rows && res1.rows.length && res1.rows[0] && res1.rows[0].id;
        if ( ! workspaceId )    throw new Error("Workspace Id is null");

        return {workspaceId};

    } catch (error) {
        console.log("Error in editWorkSpace. Error = ", error);
        throw error;
    }
}

const deleteWorkSpace = async (payload) => {
    const client = await pool.connect();
    let q, res;
    try {
        await client.query('BEGIN');

        let { workspaceId, userId } = payload;
        if ( ! workspaceId )     throw new Error("workspaceId is null");
        if ( ! userId )     throw new Error("UserId is null");

        // Query to add userId in workspace document
        let q = `UPDATE ${workspaceModel.tableName} \
            SET \
                ${workspaceModel.columnName.deleted_by} = '${userId}', \
                ${workspaceModel.columnName.deleted_at} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000 \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' \
            RETURNING ${workspaceModel.columnName.id}, ${workspaceModel.columnName.course_id} \
        `;
        
        res = await client.query(q);
        res = res && res.rows && res.rows.length && res.rows[0];
        workspaceId = res && res.id;
        if ( ! workspaceId )    throw new Error("Workspace Id is null");

        let courseId = res[workspaceModel.columnName.course_id];
        if ( courseId ) {
            res = await axios.post(`${cqBackendUrl}${constants.cqBackendRoutes.removeWorkspaceFromCourse}`,{workspaceId, courseId, accessKey: constants.workspaceBackendKey});
            let data = res && res.data;
            if ( ! data || data.error )     throw new Error(`${ ( data && data.error ) ? data.error : 'Error in removing workspaceId from course'}`);
        }

        console.log("Deleted Workspace Id = ", workspaceId);

        // Query to remove all notifications of this workspace
        q = `DELETE FROM ${notificationModel.tableName} WHERE ${notificationModel.columnName.workspace_id} = '${workspaceId}'`;
        res = await client.query(q);

        await client.query('COMMIT');
        await client.release();

        q = `SELECT ${userWorkspaceDataModel.columnName.user_id} \
            FROM ${userWorkspaceDataModel.tableName} \
            WHERE ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}'`;

        res = await client.query(q);
        res = ( res && res.rows ) || [];
        let userIds = res.map(obj => obj[userWorkspaceDataModel.columnName.user_id]);

        notificationController.emitUserNotifications({ userIds });
        
        return {workspaceId: workspaceId};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Failed query = ", q);
        console.log("Error in deleteWorkSpace. Error = ", error);
        throw error;
    }
}

const addUserToWorkSpace = async (payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let { userId, workSpaceId, createdBy } = payload;
        if ( ! userId )             throw new Error("UserId is null");
        if ( ! workSpaceId )        throw new Error("WorkSpaceId is null");
        if ( ! createdBy )          throw new Error("CreatedBy is null");

        // Query to insert workspaceId in user document
        let query1 = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.workspace_ids} = ARRAY_APPEND(${userModel.columnName.workspace_ids}, '${workSpaceId}') \
            WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.workspace_ids} @> ARRAY['${workSpaceId}']::UUID[] ) \
        `
        
        // Query to add userId in workspace document
        let query2 = `UPDATE ${workspaceModel.tableName} \
            SET ${workspaceModel.columnName.user_ids} = ARRAY_APPEND(${workspaceModel.columnName.user_ids}, '${userId}') \
            WHERE ${workspaceModel.columnName.id} = '${workSpaceId}' AND NOT ( ${workspaceModel.columnName.user_ids} @> ARRAY['${userId}']::VARCHAR(100)[] ) \
        `
        //console.log("q1 = ", query1);
        const res1 = await client.query(query1);
        
        //console.log("q2 = ", query2);
        const res2 = await client.query(query2);
        
        await client.query('COMMIT');
        await client.release();

        return {res1, res2};
    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in addUserToWorkSpace. Error = ", error);
        throw error;
    }
}

const listUserWorkspaces = async (payload) => {
    let q, res;
    try {
        let { userId } = payload;
        if ( ! userId )             throw new Error("UserId is null");

        q = `SELECT \
                ${workspaceModel.columnName.id}, \
                ${workspaceModel.columnName.name}, \
                ${workspaceModel.columnName.type}, \
                ${workspaceModel.columnName.course_id}, \
                ${workspaceModel.columnName.created_at}, \
                ${workspaceModel.columnName.created_by}, \
                ${workspaceModel.columnName.deleted_by} \
            FROM ${workspaceModel.tableName} \
            WHERE \
                ${workspaceModel.columnName.id} = ANY(ARRAY(\
                    SELECT ${userModel.columnName.workspace_ids} \
                    FROM ${userModel.tableName} \
                    WHERE ${userModel.columnName.id} = '${userId}' \
                )) AND \
                ${workspaceModel.columnName.state} = ${constants.state.active} AND \
                ${workspaceModel.columnName.deleted_by} IS NULL \
            `;
        
        //console.log("q = ", q);
        res = await pool.query(q) || {};
        const workspacesArr = res.rows || [];

        q = `SELECT \
                ${userModel.columnName.last_active_workspace_id}, \
                ${userModel.columnName.last_active_channel_id} \
            FROM ${userModel.tableName} \
            WHERE ${userModel.columnName.id} = '${userId}' \
        `;
        res = await pool.query(q) || {};
        res = ( res.rows.length && res.rows[0] ) || {};
        let lastActiveWorkspaceId = res[userModel.columnName.last_active_workspace_id];
        let lastActiveChannelId = res[userModel.columnName.last_active_channel_id];

        let isLastActiveWorkspaceExist;
        if ( lastActiveWorkspaceId ) {
            for (let index = 0; index < workspacesArr.length; index++) {
                if ( lastActiveWorkspaceId == workspacesArr[index].id ) {
                    isLastActiveWorkspaceExist = true;
                    break;
                }
            }
        }

        if ( ! isLastActiveWorkspaceExist ) {
            lastActiveWorkspaceId = ( workspacesArr[0] && workspacesArr[0].id ) || null;
            lastActiveChannelId = null;
        }

       // console.log("lastActiveWorkspaceId = ", lastActiveWorkspaceId);
       // console.log("lastActiveChannelId = ", lastActiveChannelId);

        return {workspacesArr, lastActiveWorkspaceId, lastActiveChannelId};
    } catch (error) {
        console.log("Failed query = ", q);
        console.log("Error in listUserWorkspaces. Error = ", error);
        //throw error;
	    return {workspacesArr: []}
    }
}

const addWorkspaceInActiveWorkspacesSet = async (workspaceId) => {
    try {
        if ( ! workspaceId )         throw new Error("workspaceId is null");

        await redisService.redis('sadd', redisKeys.activeWorkspaceIdsSet, workspaceId);
        return ;

    } catch (error) {
        console.log("Error addWorkspaceInActiveWorkspacesSet = ", error);
        throw error;
    }
}

const removeWorkspaceFromActiveWorkspacesSet = async (workspaceId) => {
    try {
        if ( ! workspaceId )         throw new Error("workspaceId is null");

        await redisService.redis('srem', redisKeys.activeWorkspaceIdsSet, workspaceId);
        return ;

    } catch (error) {
        console.log("Error removeWorkspaceFromActiveWorkspacesSet = ", error);
        throw error;
    }
}

const updateWorkSpaceState = async (payload) => {
    try {
        let { workspaceId, isActive } = payload;

        state = isActive ? constants.state.active : constants.state.inActive;

        if ( ! workspaceId )     throw new Error("WorkspaceId is null");
        if ( ! state )           throw new Error("state is null");

        let q = `UPDATE ${workspaceModel.tableName} \
            SET ${workspaceModel.columnName.state} = '${state}' \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' \
            RETURNING ${workspaceModel.columnName.id} \
        `;
        
        let res = await pool.query(q);
        workspaceId = res && res.rows && res.rows.length && res.rows[0] && res.rows[0].id;
        if ( ! workspaceId )    throw new Error("Workspace Id is null");

        if ( state == constants.state.inActive ) {
            q = `DELETE FROM ${notificationModel.tableName} WHERE ${notificationModel.columnName.workspace_id} = '${workspaceId}'`;
            await pool.query(q);
        }

        return {workspaceId};

    } catch (error) {
        console.log("Error in updateWorkSpaceState. Error = ", error);
        throw error;
    }
}

const listUserWorkspacesAdvanced = async (payload) => {
    let q, res;
    try {
        let { userId, workspaceId, channelId, messageId, replyId, courseId } = payload;
        if ( ! userId )             throw new Error("UserId is null");

        let workspacesDataObj = await listUserWorkspaces({userId});
        let { workspacesArr, lastActiveWorkspaceId, lastActiveChannelId } = workspacesDataObj;

        if ( workspacesArr.length == 0 )    return {...workspacesDataObj};

        let courseWorkspaceId;
        if ( ! workspaceId && courseId ) {
            workspacesArr.map(wObj => {
                if(courseId === wObj['course_id']) {
                    courseWorkspaceId = wObj['id'];
                }
            });

            if(!courseWorkspaceId) {
                console.log("no corresponding workspace for courseId.");
                return {...workspacesDataObj};
            }
        }

        const activeWorkspaceId = workspaceId || courseWorkspaceId || lastActiveWorkspaceId || workspacesArr[0]['id'];
        
        let channelsDataObj = await channelController.listChannels({userId, 'workspaceId': activeWorkspaceId}) || {};
        let { channelsArr = [], usersData = {} } = channelsDataObj;

        if ( channelsArr.length == 0 ) {
            return {
                ...workspacesDataObj,
                lastActiveWorkspaceId: activeWorkspaceId,
                lastActiveChannelId: null
            };
        }

        if ( ! channelId && lastActiveWorkspaceId != activeWorkspaceId  ) {
            lastActiveChannelId = channelsDataObj.lastActiveChannelId || null;
        }
        
        lastActiveChannelId = channelId || lastActiveChannelId || ( channelsArr[0] && channelsArr[0]['id'] );
        let lastActiveChannelLastSeen;

        let createdByData = {};
        for (let index = 0; index < channelsArr.length; index++) {
            const channelObj = channelsArr[index];
            if (channelObj.id == lastActiveChannelId) {
                const creatorId = channelObj.created_by;
                if ( creatorId ) {
                    if ( usersData[creatorId] )     createdByData[creatorId] = usersData[creatorId];
                    else {
                        createdByData = await userController.getUsersData([creatorId]) || {};
                    }
                }
                lastActiveChannelLastSeen = channelObj.last_seen;
                break;
            }
        }

        let listMessagePayload = {
            'workspaceId': activeWorkspaceId,
            'channelId': lastActiveChannelId,
            'isPrevious': 0,
            'limit': 10,
            lastSeen: lastActiveChannelLastSeen,
            includeLastSeen: true,
            userId,
        }

        if (  messageId )   listMessagePayload['messageId'] = messageId;

        let messagesObj = await messageController.listMessages(listMessagePayload);

        listMessagePayload.isPrevious = 1;
        delete listMessagePayload.includeLastSeen;
        let messagesObj2 = await messageController.listMessages(listMessagePayload);

        let dataObj = {
            ...workspacesDataObj,
            ...channelsDataObj,
            messagesArr: messagesObj.messagesArr.concat(messagesObj2.messagesArr),
            usersData: {...messagesObj.usersData, ...messagesObj2.usersData, ...createdByData},
        }
        dataObj.lastActiveWorkspaceId = activeWorkspaceId;
        dataObj.lastActiveChannelId = lastActiveChannelId;

        if ( replyId ) {
            let repliesObj = await messageController.listReplies({channelId, workspaceId, parentIdOfReply: messageId}) || {};
            dataObj.repliesArr = repliesObj.repliesArr;
            dataObj.usersData = {...dataObj.usersData, ...repliesObj.usersData}
        }

        return dataObj;
    } catch (error) {
        console.log("Failed query = ", q);
        console.log("Error in listUserWorkspaces. Error = ", error);
        throw error;
    }
}

module.exports = {
    createWorkSpace,
    editWorkSpace,
    deleteWorkSpace,
    addUserToWorkSpace,
    listUserWorkspaces,
    addWorkspaceInActiveWorkspacesSet,
    removeWorkspaceFromActiveWorkspacesSet,
    updateWorkSpaceState,
    listUserWorkspacesAdvanced,
}
