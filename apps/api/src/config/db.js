import mongoose from "mongoose";
import { env } from "./env.js";

let connectionPromise;

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState !== 2 || !connectionPromise) {
    connectionPromise = mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 })
      .then(() => console.log("MongoDB connected"))
      .catch(error => {
        connectionPromise = undefined;
        throw error;
      });
  }
  await connectionPromise;
}
