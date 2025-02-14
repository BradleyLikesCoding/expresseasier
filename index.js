import fs from "fs";
import path from "path";
import express from "express";
import { Sequelize, DataTypes } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import session from "express-session";
import bcrypt from "bcrypt";
import connectSessionSequelize from 'connect-session-sequelize'
import { dir } from "console";
const SequelizeStore = connectSessionSequelize(session.Store);

class SQLiteDB {
    constructor(DBPathOrDB, logging) {
        if (DBPathOrDB instanceof Sequelize) {
            this.seq = DBPathOrDB;
        } else {
            this.seq = new Sequelize("sqlite://" + DBPathOrDB, {
                logging: logging
            });
        }
        this.models = {};
    }

    generateID(type = "uuid") {
        switch (type) {
            case "uuid":
                return uuidv4();
            case "nanoid":
                return nanoid();
        }
    }

    async define(name, data, logging = false) {
        this.models[name] = this.seq.define(name, data);
        await this.models[name].sync({ logging: false });
        return;
    }

    async hash(value, saltrounds) {
        try {
            return await bcrypt.hash(value, saltrounds);
        } catch (error) {
            console.error('Error hashing:', error);
        }
    }

    async verifyHash(plainText, hashed) {
        try {
            return await bcrypt.compare(plainText, hashed);
        } catch (error) {
            console.error('Error verifying hash: ', error);
        }
    }
}

class ExpressEasier {
    constructor(directory) {
        this.appDirectory = directory;
        this.app = express();
        this.usingViewEngine = false;
        this.config = { "ignoreViewsPaths": [] };
    }

    async callbackWrapper(callback, args) {
        var result = callback(...args);
        if (result instanceof Promise) {
            return await result;
        }
        return result;
    }

    useErrorHandling() {
        
    }

    useBodyParsing() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
    }

    async useSession(secret = process.env.SESSION_SECRET) {
        if (this.db !== undefined) {
            const store = new SequelizeStore({
                db: this.db.seq,
                checkExpirationInterval: 15 * 60 * 1000, // 15 minutes
                expiration: 7 * 24 * 60 * 60 * 1000 // 1 Week
            });
            store.sync();

            this.app.use(
                session({
                    saveUninitialized: false,
                    secret: secret,
                    resave: false,
                    store: store
                })
            )
        } else {
            throw ("Sequelize database must be used before using sessions");
        }
    }

    useSequelize(DBPathOrDB = "database.db", logging = false) {
        this.db = new SQLiteDB(DBPathOrDB, logging);
    }

    getViewPathFromURLPath(urlPath) {
        if (urlPath === "/") {
            const indexPath = path.join("public", `index.${this.viewExtension}`);
            const indexInDirPath = path.join("public", "index", `index.${this.viewExtension}`);
            if (fs.existsSync(indexPath)) {
                return indexPath;
            } else if (fs.existsSync(indexInDirPath)) {
                return indexInDirPath;
            } else {
                return false;
            }
        } else {
            urlPath = urlPath.replace(/\/$/, "");
            if (urlPath.endsWith("." + this.viewExtension)) {
                const filePath = path.join("public", urlPath);
                if (fs.existsSync(filePath)) {
                    return filePath;
                } else {
                    return false;
                }
            } else {
                const fileWithExtensionPath = path.join("public", `${urlPath}.${this.viewExtension}`);
                const indexPath = path.join("public", urlPath, `index.${this.viewExtension}`);
                if (fs.existsSync(fileWithExtensionPath)) {
                    return fileWithExtensionPath;
                } else if (fs.existsSync(indexPath)) {
                    return indexPath;
                } else {
                    return false;
                }
            }
        }
    }

    useViews(viewEngine, viewExtension, pathArg = "") {
        this.usingViewEngine = true;
        this.viewEngine = viewEngine;
        this.viewExtension = viewExtension;
        this.views = {};
        this.app.set("view engine", viewEngine);
        this.app.set("views", path.join("public"));

        this.app.use(pathArg, async (req, res, next) => {
            if (req.path.replace(/\/$/, "").replace(/^\//, "") in this.config.ignoreViewsPaths) {
                next();
                return;
            }

            try {
                const ext = path.extname(req.path);
                if (ext === this.viewEngine || ext === "") {
                    const filePath = this.getViewPathFromURLPath(req.path);
                    if (filePath !== false) {
                        let args;
                        try {
                            args = await this.callbackWrapper(this.views[filePath]);
                        } catch {
                            res.send(this.render(filePath, { req: req, res: res }));
                            return;
                        }
                        if (args === false) {
                            return;
                        } else if (args !== undefined) {
                            res.send(this.render(filePath, { req: req, res: res, ...args }));
                            return;
                        } else {
                            res.send(this.render(filePath, { req: req, res: res }));
                            return;
                        }
                    } else {
                        next();
                    }
                } else {
                    next();
                }
            } catch (err) {
                console.error(err.message);
                this.return500(res);
            }
        });
    }

    useStatic(pathArg = "") {
        this.app.use(pathArg, express.static("public"));
    }

    use404(pathArg = "") {
        this.app.use(pathArg, (req, res) => {
            if (fs.existsSync(path.join("public", "404." + this.viewExtension))) {
                res.status(404).send(this.render("404", { req: req, res: res }));
            } else if (fs.existsSync(path.join(this.appDirectory, "public", "500.html"))) {
                res.status(404).sendFile(path.join(this.appDirectory, "public", "500.html"));
            } else {
                res.status(404).send("<h1>404 Page Not Found</h1>");
            }
        });
    }

    return500(res) {
        if (fs.existsSync(path.join("public/500." + this.viewExtension))) {
            res.status(404).send(this.render("404", { req: req, res: res }));
        } else if (fs.existsSync(path.join(this.appDirectory, "public", "500.html"))) {
            res.status(404).sendFile(path.join(this.appDirectory, "public", "500.html"));
        } else {
            res.status(404).send("<h1>500 Internal Server Error</h1>");
        }
    }

    use(pathOrMiddleware, middleware) {
        if (typeof pathOrMiddleware === 'string') {
            this.app.use(pathOrMiddleware, middleware);
        } else {
            this.app.use(pathOrMiddleware);
        }
    }

    render(view, data) {
        if(this.usingViewEngine) {
        return this.viewEngine.render(view, data);
        } else {
            console.error("Cannot render when not using views");
            return;
        }
    }

    addView(path, callback) {
        this.views[path] = callback;
    }

    ignoreViewsForPath(path) {
        this.config.ignoreViewsPaths.push(path.replace(/\/$/, "").replace(/^\//, ""));
    }

    listen(port, callback) {
        this.server = this.app.listen(port, callback);
    }

    gracefulShutdown() {
        console.log('Received termination signal. Shutting down gracefully...');

        this.server.close(() => {
          console.log('Closed all connections.');
          if (this.onShutdown !== undefined) {
            this.onShutdown();
          }
          process.exit(0);
        });
        
        // Force exit if there are ongoing requests after a certain timeout (e.g., 10 seconds)
        setTimeout(() => {
          console.error('Force shutdown after 10 seconds');
          process.exit(1);
        }, 10000);
    }
}

export default ExpressEasier;