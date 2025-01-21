import fs from "fs";
import path from "path";
import express from "express";
import { Sequelize, DataTypes } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import session from "express-session";
import bcrypt from "bcrypt";
import connectSessionSequelize from 'connect-session-sequelize'
const SequelizeStore = connectSessionSequelize(session.Store);

class SQLiteDB {
    constructor(DBPath) {
        this.seq = new Sequelize("sqlite://" + path.join(DBPath));
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
    constructor(viewEngine, viewExtension) {
        this.app = express();
        this.viewEngine = viewEngine;
        this.viewExtension = viewExtension;
        this.views = {};
        this.config = { "templateIgnorePaths": [] };
        this.app.set("view engine", viewEngine);
        this.app.set("views", path.join(process.cwd(), "public"));
    }

    async callbackWrapper(callback, args) {
        var result = callback(...args);
        if (result instanceof Promise) {
            return await result;
        }
        return result;
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

    useSequelize(path = "database.db") {
        this.db = new SQLiteDB(path);
    }

    useTemplates(pathArg = "") {
        this.app.use(pathArg, async (req, res, next) => {
            if (req.path in this.config.templateIgnorePaths) {
                next();
                return;
            }
            try {
                const ext = path.extname(req.path);
                if (ext === this.viewEngine || ext === "") {
                    const filePath = path.join(process.cwd(), "public", (req.path == "/" ? "index" : req.path.replace(/\/$/, '')) + (ext === this.viewEngine ? "" : "." + this.viewExtension));
                    if (fs.existsSync(filePath)) {
                        var args;
                        try {
                            args = await this.callbackWrapper(this.views[(req.path == "/" ? "/index" : req.path.replace(/\/$/, '')) + (ext === this.viewEngine ? "" : "." + this.viewExtension)], [req, res, next]);
                        } catch {
                            res.send(this.render(filePath, { req: req, res: res }));
                            return;
                        }
                        if (args !== false && args !== undefined) {
                            res.send(this.render(filePath, { req: req, res: res, ...args }));
                        }
                        return;
                    }
                }

                next();
            } catch (err) {
                console.log(err.message);
                this.return500(res);
            }
        });
    }

    useStatic(pathArg = "") {
        this.app.use(pathArg, express.static(path.join(process.cwd(), "public")));
    }

    use404(pathArg = "") {
        this.app.use(pathArg, (req, res) => {
            if (fs.existsSync(path.join(process.cwd(), "public", "404." + this.viewExtension))) {
                res.status(404).send(this.render("404", { req: req, res: res }));
            } else if (fs.existsSync(path.join(process.cwd(), "public", "404.html"))) {
                res.status(404).sendFile(path.join(process.cwd(), "public", "404.html"));
            } else {
                res.status(404).send("<h1>404 Page Not Found</h1>");
            }
        });
    }

    return500(res) {
        if (fs.existsSync(path.join(process.cwd(), "public", "500." + this.viewExtension))) {
            res.status(404).send(this.render("404", { req: req, res: res }));
        } else if (fs.existsSync(path.join(process.cwd(), "public", "500.html"))) {
            res.status(404).sendFile(path.join(process.cwd(), "public", "500.html"));
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

    render(template, data) {
        return this.viewEngine.render(template, data);
    }

    addView(path, callback) {
        this.views[path] = callback;
    }

    listen(port, callback) {
        this.app.listen(port, callback);
    }
}

export default ExpressEasier;