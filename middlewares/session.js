
const jwt = require('jsonwebtoken');

const controllers = require('../controllers');
const libs = require('../lib');
const config = require('../config/configVars');

/**
 * 
 * @param {boolean} condition 
 * @returns {import('../@types/global').RequestHandler1}
 */
const checkLogin = (condition) => {
    return (req,  res, next) => {
        try {
            const isLoggedIn  = (req?.session?.userId)?true:false;
            if ( isLoggedIn === condition ) return next();
            if (!req?.session?.userId) {
                throw new Error(libs.messages.errorMessage.sessionExpired);
            }
            if (!req.session?.userId) {
                return res.status(401).json({error: libs.messages.errorMessage.sessionExpired})
            }
            return res.status(403).json({error: libs.messages.errorMessage.genericMessage});
        } catch (error) {
            console.log(error);
            return res.status(500).json({error: error?.message ?? error});
        }
    }
}

/**
 * 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {() =>  void} next 
 * @returns 
 */
const populateSession = async (req, res, next) => {
    try {
        const sKey = req.cookies.jwt ?? req.body.authToken;
        req.isAuthenticated = false;
        req.session = {};
        if (sKey) {
            delete req.body.authToken;
            const sessionObj  = await controllers.authController.authenticateSession(sKey);
            if (sessionObj) {
                req.isAuthenticated = true;
                req.session = sessionObj;
                return next();
            }
        }
        
        const lKey = req.cookies.ljwt;
        if (lKey) {
            const userData = jwt.verify(lKey, libs.constants.jwtSecret);
            const {email} = userData;
            console.log(userData);
            const [token] = await controllers.authController.login({email}, true);
            if (!token) throw new Error('Token not present');
            res.cookie('jwt', token, config.sessionCookieConfig);
            const sessionObj = await controllers.authController.authenticateSession(token);
            if (!sessionObj) throw new Error('Session obj not present');
            req.isAuthenticated = true;
            req.session = sessionObj;
        }

        return next();
    } catch (error) {
        console.log(error);
        req.isAuthenticated = false;
        req.session = {};
        res.clearCookie('jwt');
        res.clearCookie('ljwt');
        return next();
    }
}

module.exports = {
    checkLogin,
    populateSession,
}