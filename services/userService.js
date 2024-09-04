const {pool} = require('../config/postgres');
const axios = require('axios');


const {loginUrl} = require('../config/configVars');
const user = require('../models/user');

var getUserFormDb = async function (columnsToGet, rawCondition) {
    try {
        let query = `SELECT `;
        if (!columnsToGet?.length) {
            query += `* `;
        } else {
            columnsToGet.forEach((current_column, index) => {
                if (index != 0) {
                    query += ',';
                }
                query += ` ${current_column}`
            })
        }
        query += ` FROM ${user.tableName} `;
        query += ` ${rawCondition};`;
        // console.log(query);
        const result = await pool.query(query);
        return result?.rows;
    } catch (error) {
        console.log(error);
        throw new Error('Something went wrong');
    }
}

const getSingleUserFromDb = async function (rowsToGet, rawCondition) {
    try {
        let query = `SELECT `;
        if (!rowsToGet?.length) {
            query += `* `;
        }
        if (rowsToGet?.length) {
            rowsToGet.forEach((current_column) => {
                query += ` ${current_column}`
            })
        }
        query += ` FROM ${user.tableName} `;
        query += ` ${rawCondition};`;
        // console.log(query);
        const result = await pool.query(query);
        return result?.rows?.[0];
    } catch (error) {
        console.log(error);
        throw new Error(`Something wen wrong`);
    }
}

var createUserDB = async function (userData) {
    try {
        let query = `INSERT INTO ${user.tableName} (`
        const keys = Object.keys(userData);
        keys.forEach((element, index) => {
            query += ` ${element} `;
            if (index < (keys.length - 1)) {
                query += ',';
            }  
        })
        query += ') values (';
        const values = Object.values(userData);
        values.forEach((element, index) => {
            if (typeof element === 'string') {
                query += ` '${element}'`
            } else {
                query += ` ${element} `;
            }
            if (index < (values.length - 1)) {
                query += ',';
            }  
        })
        query += `) RETURNING *;`;
        const result =  await pool.query(query);
        return result;
    } catch (error) {
        console.log(error);
        throw new Error('Something went wronng.');
    }
}


/**
 * 
 * @param {{[string]: any}} dataToSet
 * @param {string} rawCondition 
 */
const updateUserDB = async function (dataToSet, rawCondition) {
    let query = `UPDATE ${user.tableName} SET `
    Object.entries(dataToSet).forEach(([key, value], index) => {
        if (index !== 0) {
            query += ' , ';
        }
        console.log(key, value);
        query += `${key} = `
        if (typeof value === 'string') {
            query += ` '${value}' `
        } else if (value === null) {
            query += ` NULL `;
        } else {
            query += value;
        }

    });
    query += rawCondition ?? '';
    query += ' RETURNING *;'
    console.log(query);
    const result = await pool.query(query);
    return result?.rows;
}

const userQuery = async function( method, criteria = {}, projection = {}, options = {}, callback ) {
    try {
        if ( ! ( method ) )     throw new Error("Error userQuery Method name is null");
        let obj = {
            criteria,
            projection,
            options,
            method
        }
        if( options.userEvent ){
            delete options.userEvent;
            obj.userEvent = true
        }
        let url = `${loginUrl}/user/dbquery`;
        const response = await axios.post(url, obj)
        if ( callback )     return callback(null, response.data && response.data.data);
        return response.data && response.data.data;
    }
    catch(err) {
        console.log("User Query Error = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
}

//Get Users from DB
var getUser = async function (criteria, projection, options = {}, callback) {
    try {
        options.lean = true;
        let user = await userQuery('getUser', criteria, projection, options);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	    console.log("getUser ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
    
};

//Get One User from DB
var getOneUser = async function (criteria, projection, options = {}, callback) {
    try {
        options.lean = true;
        let user = await userQuery('getOneUser', criteria, projection, options);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	    console.log("getOneUser ERror = ", err);    
        if ( callback )     return callback(err);
        throw err;
    }
};


//Insert User in DB
var createUser = async function (objToSave, callback) {
    try {
        let user = await userQuery('createUser', objToSave);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	console.log("createUser ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
};

//Update User in DB
var updateUser = async function (criteria, dataToSet, options = {}, callback) {
    options.lean = true;
    options.new = true;
    try {
        options.lean = true;
        options.new = true;
        let user = await userQuery('updateUser', criteria, dataToSet, options);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	    console.log("updateUser ERror = ", err);    
        if ( callback )     return callback(err);
        throw err;
    }
};

//Delete User in DB
var deleteUser = async function (criteria, callback) {
    try {
        let user = await userQuery('deleteUser', criteria);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	    console.log("deleteUser ERror = ", err);
        if ( callback )     return callback(err);
        throw err;;
    }
};

var getUsersCount = async function (criteria, callback) {
    try {
        let user = await userQuery('getUsersCount', criteria);
        if ( callback )     return callback(null, user);
        return user;
    }
    catch (err) {
	    console.log("getUsersCount ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
};

var bulkUpdate = async function(criteriaArr = [], updateArr = [], castObj = {}, options = {}, callback) {
    try {
        let obj = {
            criteriaArr,
            updateArr,
            castObj,
            options,
        }
        let url = `${loginUrl}/user/bulkupdate`;
        const response = await axios.post(url, obj);
        console.log("Res = ", response.data)
        if ( callback )     return callback(null, response.data && response.data.data);
        return response.data && response.data.data;
    }
    catch (err) {
	      console.log("bulkUPdate ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
}

var bulkInsert = async function( insertArr = [], castObj = {}, options = {}, callback) {
    try {
        let obj = {
            insertArr,
            castObj
        }
        if( options.userEvent ) obj.userEvent = true;
        let url = `${loginUrl}/user/bulkinsert`;
        const response = await axios.post(url, obj);
        console.log("Res = ", response.data)
        if ( callback )     return callback(null, response.data && response.data.data);
        return response.data && response.data.data;
    }
    catch (err) {
	      console.log("bulkUPdate ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
}

var updateUsers = async function (criteria, dataToSet, options = {}, callback) {
    try {
        options.lean = true;
        options.new = true;
        let users = await userQuery('updateUsers', criteria, dataToSet, options);
        if ( callback )     return callback(null, users);
        return users;
    }
    catch (err) {
	    console.log("updateUsers ERror = ", err);
        if ( callback )     return callback(err);
        throw err;
    }
};

module.exports = {
    getUser,
    updateUser,
    deleteUser,
    createUser,
    getOneUser,
    bulkUpdate,
    bulkInsert,
    updateUsers,
    getUsersCount,
    getUserFormDb,
    createUserDB,
    getSingleUserFromDb,
    updateUserDB,
};

