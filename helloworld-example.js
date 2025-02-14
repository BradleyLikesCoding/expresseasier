import ExpressEasier from "./index.js";
import path from "path";

const backend = new ExpressEasier();

backend.use("/", (req, res, next) => {
    res.sendFile(path.join(process.cwd(), "public/helloworld.html"));
});

backend.listen(process.env.PORT || 8080, () => {
    console.log("Server is running on port " + (process.env.PORT || 8080));
});