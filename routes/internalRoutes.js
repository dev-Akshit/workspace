const router = require('express').Router();

const {workspaceController, channelController} = require("../controllers");
const utils = require('../lib/utils');

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      userIds: [ObjectId(String)],
      workspaceBackendKey: String,
*/
router.post('/addUsersToChannel', utils.isInternalRouteAuthenticated, async (req, res) => {
    try {
        let obj = await channelController.addMultipleUsersToChannel(req.body);
        res.json(obj || {});
    } catch (error) {
        console.log("Error in addBatchToChannel. Error = ", error);
        res.json({ 'error': error.message });
    }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      userIds: [ObjectId(String)],
      workspaceBackendKey: String,
*/
router.post('/removeUsersFromChannel', utils.isInternalRouteAuthenticated, async (req, res) => {
    try {
        let obj = await channelController.removeMultipleUsersFromChannel(req.body);
        res.json(obj || {});
    } catch (error) {
        console.log("Error in removeUsersFromChannel. Error = ", error);
        res.json({ 'error': error.message });
    }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      name: String, 
*/
router.post('/updateWorkspaceName', utils.isInternalRouteAuthenticated, async (req, res) => {
    try {
        let obj = await workspaceController.editWorkSpace(req.body);
        res.json(obj || {});
    } catch (error) {
        console.log("Error in updateWorkspaceName. Error = ", error);
        res.json({ 'error': error.message });
    }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      isActive: Bool,
*/
router.post('/updateWorkspaceState', utils.isInternalRouteAuthenticated, async (req, res) => {
    try {
        let obj = await workspaceController.updateWorkSpaceState(req.body);
        res.json(obj || {});
    } catch (error) {
        console.log("Error in updateWorkspaceState. Error = ", error);
        res.json({ 'error': error.message });
    }
});

module.exports = router;
