const utils = require("../utils");
const channelController = require("../controllers/channelController");
const userController = require('../controllers/userController');
const express = require("express");
const router = express.Router();
const config = require('../config/configVars');

/*
  Input Body - 
      userId: String,
      workspaceId: UUID(String),
      channelId: UUID(String),
*/
router.get('/addUserToChannel', async (req, res) => {
    const token = req.query.token;
    let data = await utils.jwtToken.verifyToken(token, config.jwtSecret);
    const { workspaceId, channelId, userIdToAdd: userId  } = data; 
    try {
    
        data = {...data, userId: data.userIdToAdd} ;  
        let obj = await channelController.addUserToChannel(data);
        await userController.setLastActiveData({
          workspaceId: workspaceId,
          userId: userId,
          channelId: channelId,
        })
        res.redirect(config.frontendURL);
    } catch (error) {
      console.log("Error in addUserToChannel. Error = ", error);
      res.json({'error': error.message});  
    } 
});

module.exports = router;