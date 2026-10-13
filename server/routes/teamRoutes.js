import express from 'express';
import jwtAuthMiddleware from '../middleware/auth.js';
import checkAdmin from '../middleware/admin.js';
import {
    getMyTeams,
    getDirectory,
    createTeam,
    updateTeam,
    deleteTeam,
    getNotices,
    assignIssueToBot,
} from '../controllers/teamController.js';

const router = express.Router();

// Everyone (scoped to their own teams inside the controller)
router.get('/', jwtAuthMiddleware, getMyTeams);
router.get('/notices', jwtAuthMiddleware, getNotices);

// Admins + team leaders (checked in controller)
router.get('/directory', jwtAuthMiddleware, getDirectory);
router.put('/:id', jwtAuthMiddleware, updateTeam);
router.post('/:id/bot/:issueNumber', jwtAuthMiddleware, assignIssueToBot);

// 👑 Admin only
router.post('/', jwtAuthMiddleware, checkAdmin, createTeam);
router.delete('/:id', jwtAuthMiddleware, checkAdmin, deleteTeam);

export default router;
