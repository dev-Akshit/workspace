const jwt = require("jsonwebtoken");

async function generateToken(data, secret){
    if(!data){
        throw new Error("No data for creating token");
    }
    return jwt.sign(data, secret);
}

async function verifyToken(token, secret){
    if(!token){
        throw new Error("Token is unavailable");
    }
    return jwt.verify(token , secret);
}

module.exports = {
    generateToken,
    verifyToken
}