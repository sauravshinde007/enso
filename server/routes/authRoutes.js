import express from "express";
import passport from "passport";
import jwtAuthMiddleware from "../middleware/auth.js";
import {
    signup,
    login,
    getMe,
    forgotPassword,
    resetPassword,
    googleCallback
} from "../controllers/authController.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", jwtAuthMiddleware, getMe);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Google Auth Routes

//Directs to google sign up page and asks for profile and email permissions
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// executes the function in passport.js controller and then calls the callback function
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }), //if it failes it redirects to the login page
    googleCallback
);



export default router;
