const postgreUtil = require('pg/lib/utils');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const crypto = require('crypto');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'))
dayjs.extend(require('dayjs/plugin/timezone'));

const postgres = require("../config/postgres");
const {userModel, channelModel} = require('../models');

const redisService = require('../services/redisService');
const userService = require('../services/userService');
const services = require('../services');
const libs = require('../lib');
const constants = require("../lib/constants");

const addUsers = async (payload) => {
    let { userIds = [], createdBy, workSpaceId, channelId, timeStamp = Date.now() } = payload;
    if ( ! userIds.length )     throw new Error("No userIds");

    let workSpaceIdsArr = workSpaceId ? [workSpaceId] : [];
    let channelIdsArr = channelId ? [channelId] : [];
    let valueString = '';

    userIds.map((uId, index) => {
        if ( ! uId )    return ;
        if ( index )  valueString += ',';
        valueString += `( \
            '${uId}', \
            '${createdBy || uId}', \
            '${postgreUtil.prepareValue(workSpaceIdsArr)}', \
            '${postgreUtil.prepareValue(channelIdsArr)}', \
            ${timeStamp}, \
            ${timeStamp}, \
            ${timeStamp} \
        )`;
    });

    if ( ! valueString )    throw new Error("No valid user");

    let query = `INSERT INTO ${userModel.tableName} \
        ( \
            ${userModel.columnName.id}, \
            ${userModel.columnName.created_by}, \
            ${userModel.columnName.workspace_ids}, \
            ${userModel.columnName.channel_ids}, \
            ${userModel.columnName.created_at}, \
            ${userModel.columnName.updated_at}, \
            ${userModel.columnName.last_notification_seen} \
        ) \
        VALUES ${valueString} \
        RETURNING ${userModel.columnName.id} \
    `
    
    let queryExecOutput = await postgres.query(query);
    let outputArr = ( queryExecOutput && queryExecOutput.rows ) ||  [];

    //console.log("Add user query = ", query, outputObj);
    return {users: outputArr};
}

// const addMultipleUsers = async (payload) => {
//     let { userIds, createdBy, workSpaceId, channelId } = payload;
//     if ( ! userIds )            throw new Error("UserIds is null");
//     if ( ! createdBy )          throw new Error("CreatedBy is null");
//     if ( ! userIds.length )     throw new Error("UserIds array is of zero length");

//     let workSpaceIdsArr = workSpaceId ? [workSpaceId] : [];
//     let channelIdsArr = channelId ? [channelId] : [];

//     let valueString = '';
//     for (let index = 0; index < userIds.length; index++) {
//         let id = userIds[index];
//         if ( ! id )     continue;

//         if ( index != 0 )   valueString += ' , ';
//         valueString += ` ( \ 
//             '${id}', \
//             '${createdBy}', \
//             '${postgreUtil.prepareValue(workSpaceIdsArr)}', \
//             '${postgreUtil.prepareValue(channelIdsArr)}' \
//         ) `
//     }

//     let query = `INSERT INTO ${userModel.tableName} \
//         ( \
//             ${userModel.columnName.id}, \
//             ${userModel.columnName.created_by}, \
//             ${userModel.columnName.workspace_ids}, \
//             ${userModel.columnName.channel_ids} \
//         ) \
//         VALUES ${valueString} \
//         ON CONFLICT (${userModel.columnName.id}) DO NOTHING \
//     `
    
//     let queryExecOutput = await postgres.query(query);

//     console.log("Add multiple user query = ", query)
//     return {userIds};
// }

const isUserExist = async(payload) => {
    const {userId, upsert, createdBy, timeStamp = Date.now(), email} = payload;
    if ( ! userId && !email)     throw new Error("UserId and email is null");

    let q = null;
    if (userId) {
        let id = await redisService.redis('hget', `${constants.redisKeys.userData}:${userId}`, constants.redisKeys._id);
        if ( id )    return {id};
        q = `SELECT * FROM ${userModel.tableName} WHERE ${userModel.columnName.id} = '${userId}'`;
    } else if (email) {
        q = `SELECT * FROM ${userModel.tableName} WHERE ${userModel.columnName.email} = '${email}'`;
    }

    let res = await postgres.query(q);
    let userObj = res && res.rows && res.rows.length && res.rows[0];
    if ( ! userObj && upsert ) {
        obj = await addUsers({userIds: [userId], 'createdBy': createdBy || userId, timeStamp});
        if ( ! obj )     throw new Error("Error in creating user in postgres");
        userObj = await userService.getOneUser({_id: userId}, {displayname: 1, role: 1, profilePic: 1, email: 1}, {}) || {};
        await redisService.redis('hmset', `${constants.redisKeys.userData}:${userId}`, 
            constants.redisKeys._id, userId,
            constants.redisKeys.displayname, userObj.displayname,
            constants.redisKeys.role, userObj.role,
            constants.redisKeys.email, userObj.email,
            constants.redisKeys.profilePic, userObj.profilePic,
        );
        redisService.redis('expire', `${constants.redisKeys.userData}:${userId}`, 172800);
    }
    return userObj;
}

const addChannelToUser = async (payload) => {
    let { userId, workSpaceId, createdBy } = payload;
    if ( ! userId )             throw new Error("UserId is null");
    if ( ! workSpaceId )        throw new Error("WorkSpaceId is null");
    if ( ! createdBy )          throw new Error("CreatedBy is null");

    let query = `UPDATE ${userModel.tableName} \
        SET ${userModel.columnName.workspace_ids} = ${userModel.columnName.workspace_ids} || '${workSpaceId}' \
        WHERE ${userModel.columnName.id} = '${userId}' AND NOT ( ${userModel.columnName.workspace_ids} @> ARRAY['${workSpaceId}'] ) \
        `
    let queryExecOutput = await postgres.query(query);
    let outputObj = queryExecOutput && queryExecOutput.rows && queryExecOutput.rows.length ? queryExecOutput.rows[0] : {};

    return outputObj;
}

const setLastActiveData = async (payload) => {
    try {
        const { workspaceId, channelId, userId } = payload;

        if ( ! userId )         throw new Error("UserId is null");
        if ( ! workspaceId )    throw new Error("WorkspaceId is not valid");

        q = `UPDATE ${userModel.tableName} \
            SET \
                ${userModel.columnName.last_active_workspace_id} = '${workspaceId}', \
                ${userModel.columnName.last_active_channel_id} = ${channelId ? '\'' + channelId + '\'' : null} \
            WHERE ${userModel.columnName.id} = '${userId}' \
        `;
        //console.log("Q - ", q);
        postgres.query(q);
        return ;
    } catch (error) {
        console.log("setLastActiveData Error = ", error);
        return ;
    }
}

const getUsersData = async (userIds = []) => {
    let usersData = {}, remainingUserIds = [];

    let redisPipeline = global.redisClient.pipeline();
    userIds.map(userId => redisPipeline.hgetall(`${constants.redisKeys.userData}:${userId}`));
    let pipelineOutput = await redisPipeline.exec() || [];

    pipelineOutput.map((arr, index) => {
        let userObj = arr[1] || {};
        let userId = userObj.id;
        if ( userId ) {
            userObj.fromRedis = true;
            usersData[userId] = userObj;
        }
        else {
            remainingUserIds.push(userIds[index]);
            return ;
        }
    })

    if ( remainingUserIds.length ) {

        let condition = `WHERE id = ANY(ARRAY[${remainingUserIds.filter(element => validator.isUUID(element)).map(element => `uuid('${element}')`).join(",")}])` 
        let usersObjArr = await userService.getUserFormDb(
            [   
                userModel.columnName.id,
                userModel.columnName.displayname,
                userModel.columnName.profilePic,
                userModel.columnName.email,
                userModel.columnName.status,
            ], condition
        );
        usersObjArr.map(userObj => {
            let userId = userObj.id;
            let obj = {
                [constants.redisKeys._id]: userId,
                [constants.redisKeys.displayname]: userObj.displayname,
                [constants.redisKeys.role]: userObj.role,
                [constants.redisKeys.email]: userObj.email,
                [constants.redisKeys.profilePic]: userObj.profile_pic,
                [constants.redisKeys.status]: userObj.status,
            }
            usersData[userId] = obj;
            redisService.redis('hmset', `${constants.redisKeys.userData}:${userId}`, obj);
            redisService.redis('expire', `${constants.redisKeys.userData}:${userId}`, 172800);
        })
    }
    return usersData;
}

const getChannelUsersData = async (payload) => {
    const { channelId, prefix, userId, isRemovedUsersIncluded } = payload;
    if ( ! channelId )  throw new Error("ChannelId is null");
    const q = `SELECT ${channelModel.columnName.id}, ${channelModel.columnName.user_ids}, ${channelModel.columnName.removed_user_ids} \
        FROM ${channelModel.tableName} \
        WHERE ${channelModel.columnName.id} = '${channelId}' \
    `;
    let res = await postgres.query(q);
    console.log("getChannelUsersData data = ", res && res.rows);
    const {id, user_ids = [], removed_user_ids = []} = ( res && res.rows && res.rows[0] ) || {};
    if ( ! id )     throw new Error("Channel not found");
    
    const userIds = isRemovedUsersIncluded ? user_ids.concat(removed_user_ids) : user_ids;
    // if ( prefix )   fObj['displayname'] = {$regex: `^${prefix}`, $options: 'i'};

    // const usersObjArr = await userService.getUserFormDb()''
    let condition = `WHERE id = ANY(ARRAY[${userIds.filter(element => validator.isUUID(element)).map(element => `uuid('${element}')`).join(",")}])` 
    if (prefix) condition += ` AND ( ${userModel.columnName.displayname} LIKE '${prefix}%')`// OR ${userModel.columnName.email} LIKE '${prefix}%') `
    const columnsToGet = [
        userModel.columnName.id,
        userModel.columnName.email,
        userModel.columnName.displayname,
        userModel.columnName.role,
        userModel.columnName.profilePic,
    ]
    const usersObjArr = await userService.getUserFormDb(columnsToGet, condition);
    // const usersObjArr = await userService.getUser(fObj, {email: 1, displayname: 1, role: 1, profilePic: 1}, {}) || [];
    const usersData = {};
    usersObjArr.map(obj => {
        obj._id = obj.id;
        delete obj.id;
        usersData[obj._id] = obj
    });
    return usersData;
}

/**
 * 
 * @param {{[string]: any}} criteriaObj 
 * @param {[string]: any} objToSet 
 * @returns 
 */
const updateUsersData = async  (criteriaObj, objToSet) => {
    let criteria = ` WHERE `;
    Object.entries(criteriaObj ?? {}).forEach(([key, value]) => {
        try {
            console.log(key, value);
            criteria += ` ${key} = `
            if (typeof value === 'string') {
                criteria += ` '${value}' `
            } else if (typeof value === null) {
                criteria += ` NULL `;
            } else if (value?.getTime) {
                // TYPE OF DATE
                criteria += ` `
            } else {
                criteria +=` ${value} `;
            }
        } catch (error) {
            console.log(error);
        }
    })
    const result = await userService.updateUserDB(objToSet, criteria);
    return  result;
}

const updateUserProfile = async (userId, userUpdateObj) => {
    if (!userId) throw new Error(libs.messages.errorMessage.userIdNotPresent);
    const updateObj = {}
    if ( Object.prototype.hasOwnProperty.call(userUpdateObj, 'profilePic')) {
        updateObj[userModel.columnName.profilePic] = userUpdateObj.profilePic ?? null;
    }
    if (userUpdateObj.username) {
        updateObj[userModel.columnName.displayname] = userUpdateObj.username;
    }
    if (userUpdateObj.password) {
        updateObj[userModel.columnName.password] = userUpdateObj.password;
    }
    if (userUpdateObj.status) {
        updateObj[userModel.columnName.status] = userUpdateObj.status;
    }
    if (userUpdateObj.passwordResetToken !== undefined) {
        updateObj[userModel.columnName.password_reset_token] = userUpdateObj.passwordResetToken;
    }
    if (userUpdateObj.passwordRestValidDate){
        updateObj[userModel.columnName.password_reset_token_valid_upto_date]= userUpdateObj.passwordRestValidDate;
    }
    return updateUsersData({[userModel.columnName.id]: userId}, updateObj);
}

/**
 * 
 * @param {string} email 
 */
const forgotPassword = async (email) => {
    const token = crypto.randomBytes(30).toString('hex');
    const forgotTokenValidUpto = dayjs().add(5, 'minutes').toISOString();
    const result = await updateUsersData({
            [userModel.columnName.email]: email,
        },
        {
            [userModel.columnName.password_reset_token]: token,
            [userModel.columnName.password_reset_token_valid_upto_date]: forgotTokenValidUpto, 
        }
    );

    if (!result?.length) {
        throw new Error(libs.messages.errorMessage.userNotFound);
    }
    console.log(result);
    const userData = result?.[0];
    const emailClass = services.emailService.CreateEmailFactory({
        to: email,
        Type: libs.constants.emailType.ForgotPassword,
        token: token,
        validity: dayjs(forgotTokenValidUpto).tz('Asia/Calcutta').format('DD/MMM/YY hh:mm:ss a')
    }, userData)
    await emailClass.sendEmail();
    return userData;
}

/**
 * 
 * @param {string} token 
 * @returns {Promise<string>}
 */
const validateResetPasswordToken = async (token) => {
    const condition =  `WHERE ${userModel.columnName.password_reset_token}='${token}' AND ${userModel.columnName.password_reset_token_valid_upto_date} >= '${new Date().toISOString()}'`;
    const result = await services.userService.getUserFormDb([userModel.columnName.id], condition);
    if (result.length == 0) {
        throw new Error(libs.messages.errorMessage.linkExpired);
    }
    if (result.length > 1) {
        console.error('\x1b[31m%s\x1b[0m', `Getting multiple users for validateResetPasswordToken
        Token = ${token}
        `);
        throw new Error('Something went wrong. Please try again.');
    }
    const userId = result[0][userModel.columnName.id];
    if (!userId) throw new Error(libs.messages.errorMessage.userNotFound);
    return userId;
}

const validateUserPassword = async (userId, password) => {
    const condition = `WHERE ${userModel.columnName.id} = '${userId}'`;
    const user = await services.userService.getSingleUserFromDb([userModel.columnName.password], condition);
    if (!user) {
        throw new Error('User not found');
    }
    return await libs.utils.checkIfValidEncryption(user[userModel.columnName.password], password);
}

const getUserChannelsAndWorkspace = async (userId) => {
    //query to get the channel ids and workspace ids where user is present
    const q = `SELECT ${userModel.columnName.channel_ids}, ${userModel.columnName.workspace_ids} \
                FROM ${userModel.tableName} \
                WHERE ${userModel.columnName.id} = '${userId}' \
            `;
    //console.log(q);
    const res = await postgres.query(q);
    // console.log(result);
    if ( !res ) {
        throw new Error("Something went wrong. Please try again.");
    }
    return res.rows[0];
}

module.exports = {
    addUsers,
    isUserExist,
    addChannelToUser,
    setLastActiveData,
    getUsersData,
    getChannelUsersData,
    updateUsersData,
    updateUserProfile,
    forgotPassword,
    validateUserPassword,
    validateResetPasswordToken,
    getUserChannelsAndWorkspace,
}
