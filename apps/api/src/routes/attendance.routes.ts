/** /api/attendance: geofenced check-in/out for employees, day view and regularization for staff. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/attendance.controller";

const router = express.Router();

/** POST /api/attendance/check-in  { lat, lng } */
router.post("/check-in", wrap(ctrl.checkIn));
/** POST /api/attendance/check-out  { lat, lng } */
router.post("/check-out", wrap(ctrl.checkOut));
/** GET /api/attendance/me?month=YYYY-MM, own records + today's status. */
router.get("/me", wrap(ctrl.mine));
/** GET /api/attendance?date=YYYY-MM-DD&departmentId= (staff), org-wide for a day. */
router.get("/", wrap(ctrl.day));
/**
 * POST /api/attendance/regularize (staff), correct or create an attendance record
 * for an employee on a date (forgotten check-in, system error, on-duty, etc.).
 * Body: { employeeId, date, status(PRESENT|REMOTE|ABSENT|ON_DUTY), checkInAt?, checkOutAt?, halfDay?, note }
 */
router.post("/regularize", wrap(ctrl.regularize));

export default router;
