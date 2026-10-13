// client/src/services/teamApi.js
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001";

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const errorMessage = (err, fallback = "Something went wrong") =>
  err?.response?.data?.message || err?.message || fallback;

const teamApi = {
  getTeams: (token) => axios.get(`${API_URL}/api/teams`, auth(token)).then((r) => r.data),
  getNotices: (token) => axios.get(`${API_URL}/api/teams/notices`, auth(token)).then((r) => r.data),
  getDirectory: (token) => axios.get(`${API_URL}/api/teams/directory`, auth(token)).then((r) => r.data),
  createTeam: (token, body) => axios.post(`${API_URL}/api/teams`, body, auth(token)).then((r) => r.data),
  updateTeam: (token, id, body) => axios.put(`${API_URL}/api/teams/${id}`, body, auth(token)).then((r) => r.data),
  deleteTeam: (token, id) => axios.delete(`${API_URL}/api/teams/${id}`, auth(token)).then((r) => r.data),
  assignToBot: (token, teamId, issueNumber, force = false) =>
    axios.post(`${API_URL}/api/teams/${teamId}/bot/${issueNumber}`, { force }, auth(token)).then((r) => r.data),
};

export default teamApi;
