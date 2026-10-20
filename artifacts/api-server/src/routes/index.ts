import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import applicationsRouter from "./applications";
import dashboardRouter from "./dashboard";
import gmailRouter from "./gmail";
import reviewRouter from "./review";
import remindersRouter from "./reminders";
import calendarRouter from "./calendar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(applicationsRouter);
router.use(dashboardRouter);
router.use(gmailRouter);
router.use(reviewRouter);
router.use(remindersRouter);
router.use(calendarRouter);

export default router;
