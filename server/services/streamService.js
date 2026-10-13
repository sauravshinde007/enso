import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
dotenv.config();

const serverClient = StreamChat.getInstance(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
);

export const syncUserToStream = async (user) => {
    try {
        const streamRole = user.role === 'admin' ? 'admin' : 'user';
        await serverClient.upsertUser(
            //1. id: Uniquely identifies the user within Stream. We use the database _id for consistency. (If we use the email here instead of the _id, then it creates a new account every time the user logs in with Google because the _id changes). 
            //2. name: The display name shown in the Stream Chat UI (e.g., the channel list or member list). It defaults to the username but could be a full name. 
            //3. image: The avatar URL for the user. This is used in the chat UI. If no avatar is set, it falls back to an empty string, and Stream usually shows a default placeholder. 
            //4. role: Defines the user's permissions within the Stream ecosystem. Common values are 'user', 'moderator', or 'admin'. This affects who can perform administrative actions in chats. 
            //5. metaverse_role: This is custom metadata we defined. It's not a standard Stream field, but we use it to store additional information about the user's role in our specific application logic (like 'mentor', 'student', 'designer').
            {
            id: user._id.toString(),
            name: user.username,
            image: user.avatar || "",
            role: streamRole,
            metaverse_role: user.role
        });
        return true;
    } catch (error) {
        console.error("Failed to sync user to Stream Chat:", error);
        throw error;
    }
};

export const syncUsersBatch = async (users) => {
    if (!users || users.length === 0) return;

    const streamUsers = users.map(u => ({
        id: u._id.toString(),
        name: u.username,
        image: u.avatar || "",
        role: u.role === 'admin' ? 'admin' : 'user',
        metaverse_role: u.role
    }));

    try {
        await serverClient.upsertUsers(streamUsers);
        console.log(`✅ Synced ${users.length} users to Stream Chat`);
    } catch (error) {
        console.error("Failed to batch sync users to Stream Chat:", error);
        throw error;
    }
};

export default serverClient;
