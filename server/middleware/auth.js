// server/middleware/auth.js
import jwt from 'jsonwebtoken';

export default (req, res, next) => {
    try {
        // Authorization: "Bearer TOKEN"
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new Error('No authorization header found!');
        }

        const token = authHeader.split(" ")[1];
        if (!token || token === "null" || token === "undefined") {
            throw new Error('Token is missing or invalid!');
        }

        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        req.userData = { userId: decodedToken.userId, username: decodedToken.username, role: decodedToken.role };
        next();
    } catch (err) {
        console.error("Auth Middleware Error:", err.message);
        return res.status(401).json({ message: 'Authentication failed!' });
    }
};