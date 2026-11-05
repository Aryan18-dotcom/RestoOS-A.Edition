import http from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import { configureSockets } from "./sockets/index.js";

await connectDatabase();
const server = http.createServer(app);
configureSockets(server);
server.listen(env.port, "0.0.0.0", () => console.log(`RestaurantOS API listening on ${env.port}`));
