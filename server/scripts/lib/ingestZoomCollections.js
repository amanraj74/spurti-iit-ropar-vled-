/**
 * ingestZoomCollections.js
 * 
 * Reads session data from zoom_meetings, zoom_attendance, and zoom_polls
 * collections and ingests into AttendanceRecord, PollRecord, and SPTransaction.
 * 
 * One session per day — the FIRST session of the day (earliest startTime).
 */

import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import Session from '../../models/Session.js';
import AttendanceRecord from '../../models/AttendanceRecord.js';
import PollRecord from '../../models/PollRecord.js';
import SPTransaction from '../../models/SPTransaction.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://sakshi:iitropar@127.0.0.1:27017/sakshi_spurti?authSource=sakshi_spurti';

/**
 * Find the FIRST (earliest) zoom meeting for a given date string (YYYY-MM-DD).
 */
export async function findFirstMeetingOfDay(dateStr, zoomDb) {
  const meetings = await zoomDb.collection('zoom_meetings')
    .find({ date: dateStr })
    .sort({ startTime: 1 })
    .limit(1)
    .toArray();
  return meetings[0] || null;
}

/**
 * Check if a session has already been ingested (Session doc exists + transactions exist).
 */
export async function isSessionIngested(sessionLabel) {
  const sessionDoc = await Session.findOne({ label: sessionLabel });
  if (!sessionDoc) return false;
  const txCount = await SPTransaction.countDocuments({ sessionLabel });
  return txCount > 0;
}

/**
 * Build session label from date — e.g. "2026-05-29" → "29 May Morning"
 */
export function buildSessionLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  return `${Number(d)} ${months[Number(m) - 1]} Morning`;
}

/**
 * Main ingestion function for a specific date.
 * Reads from zoom_* collections, writes to AttendanceRecord + PollRecord + SPTransaction.
 */
export async function ingestZoomSession(dateStr, options = {}) {
  const {
    dryRun = false,
    skipAttendance = false,
    skipPolls = false,
    force = false, // re-ingest even if already exists
  } = options;

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const zoomDb = db.databaseName === 'sakshi_spurti' ? db : mongoose.connection;

  // Find first meeting of the day
  const meeting = await findFirstMeetingOfDay(dateStr, db);
  if (!meeting) {
    console.log(`No meetings found for ${dateStr}`);
    return { success: false, reason: 'no_meeting' };
  }

  const sessionLabel = buildSessionLabel(dateStr);
  const existingIngested = await isSessionIngested(sessionLabel);

  if (existingIngested && !force) {
    console.log(`Session "${sessionLabel}" already ingested. Use --force to re-ingest.`);
    return { success: false, reason: 'already_ingested', sessionLabel };
  }

  console.log(`\nIngesting: ${sessionLabel}`);
  console.log(`  Meeting UUID: ${meeting._id}`);
  console.log(`  Start: ${meeting.startTime} (IST: ${new Date(meeting.startTime).toISOString()})`);
  console.log(`  Duration: ${meeting.duration} min`);
  console.log(`  Participants: ${meeting.participantsCount}`);
  console.log(`  Poll questions: ${meeting.pollQuestionCount}`);
  console.log(`  Dry run: ${dryRun}`);

  // Upsert Session document
  const sessionDoc = await Session.findOneAndUpdate(
    { label: sessionLabel },
    {
      $set: {
        label: sessionLabel,
        date: new Date(`${dateStr}T00:00:00`),
        startDateTime: meeting.startTime,
        endDateTime: meeting.endTime,
        totalMinutes: meeting.duration,
        type: 'morning',
        attendanceFile: '',
        chatFile: '',
        pollFile: ''
      }
    },
    { upsert: true, new: true }
  );

  const totalMinutes = meeting.duration;
  const endDateTime = meeting.endTime;

  // Load students
  const students = await Student.find({ status: { $ne: 'excused' } }).lean();
  console.log(`  Students to process: ${students.length}`);

  const emailToStudent = new Map(students.map(s => [s.email.toLowerCase(), s]));

  // ─── ATTENDANCE ───────────────────────────────────────────────
  const stats = { attendance: 0, pollRecords: 0, skipped: 0 };

  if (!skipAttendance) {
    const zoomAttendance = await db.collection('zoom_attendance')
      .find({ meetingUuid: meeting._id })
      .toArray();

    console.log(`  Zoom attendance records: ${zoomAttendance.length}`);

    for (const record of zoomAttendance) {
      const email = record.email?.toLowerCase();
      const student = emailToStudent.get(email);
      if (!student) {
        stats.skipped++;
        continue;
      }

      const attendedMinutes = record.duration || 0;
      const pct = totalMinutes > 0 ? Math.round((attendedMinutes / totalMinutes) * 100) : 0;
      const qualified = totalMinutes > 0 && attendedMinutes / totalMinutes >= 0.75;
      const delta = qualified ? 5 : -5;
      const reason = qualified
        ? `${sessionLabel}: attended ${attendedMinutes}/${totalMinutes} minutes (${pct}%). Required 75%, credited +5 SP.`
        : `${sessionLabel}: attended ${attendedMinutes}/${totalMinutes} minutes (${pct}%). Required 75%, debited -5 SP.`;

      if (!dryRun) {
        // Check if student was active on this date
        if (endDateTime < student.internshipStartDate) continue;

        // Create or skip attendance transaction
        const existingTx = await SPTransaction.exists({ email, category: 'attendance', sessionLabel });
        if (existingTx) {
          stats.skipped++;
          continue;
        }

        // Get current balance
        const lastTx = await SPTransaction.findOne({ email }).sort({ dateTime: -1, createdAt: -1 }).lean();
        const balanceAfter = Number(lastTx?.balanceAfter ?? student.totalSp ?? 0) + delta;

        const tx = await SPTransaction.create({
          email,
          studentId: student._id,
          category: 'attendance',
          sessionLabel,
          deltaMode: 'absolute',
          deltaValue: delta,
          appliedDelta: delta,
          balanceAfter,
          reason,
          dateTime: endDateTime
        });

        await Student.updateOne({ _id: student._id }, { $inc: { totalSp: delta } });

        await AttendanceRecord.findOneAndUpdate(
          { email, sessionLabel },
          {
            $set: {
              email,
              studentId: student._id,
              sessionLabel,
              attendedMinutes,
              totalSessionMinutes: totalMinutes,
              attendancePercentage: pct,
              qualified,
              transactionId: tx._id
            }
          },
          { upsert: true }
        );

        stats.attendance++;
      } else {
        stats.attendance++;
      }
    }
  }

  // ─── POLLS ───────────────────────────────────────────────────
  if (!skipPolls && meeting.pollQuestionCount > 0) {
    const zoomPolls = await db.collection('zoom_polls')
      .find({ meetingUuid: meeting._id })
      .toArray();

    console.log(`  Zoom poll records: ${zoomPolls.length}`);

    // Group polls by email
    const pollByEmail = new Map();
    const questionSet = new Set();
    for (const p of zoomPolls) {
      if (!pollByEmail.has(p.email)) pollByEmail.set(p.email, []);
      pollByEmail.get(p.email).push(p);
      if (p.question) questionSet.add(p.question);
    }

    const totalQuestions = meeting.pollQuestionCount;
    const questions = [...questionSet];

    for (const [email, responses] of pollByEmail) {
      const student = emailToStudent.get(email.toLowerCase());
      if (!student) continue;

      if (endDateTime < student.internshipStartDate) continue;

      const answered = responses.filter(r => r.answer && r.answer.trim() !== '');
      const attempted = answered.length;
      const missed = Math.max(0, totalQuestions - attempted);
      const delta = attempted - missed;
      const reason = `${sessionLabel}: attempted ${attempted}/${totalQuestions} poll questions. +${attempted} for attempted, -${missed} for missed = ${delta} SP.`;

      if (!dryRun) {
        const existingTx = await SPTransaction.exists({ email: email.toLowerCase(), category: 'poll', sessionLabel });
        if (existingTx) {
          stats.skipped++;
          continue;
        }

        const lastTx = await SPTransaction.findOne({ email: email.toLowerCase() }).sort({ dateTime: -1, createdAt: -1 }).lean();
        const balanceAfter = Number(lastTx?.balanceAfter ?? student.totalSp ?? 0) + delta;

        const tx = await SPTransaction.create({
          email: email.toLowerCase(),
          studentId: student._id,
          category: 'poll',
          sessionLabel,
          deltaMode: 'absolute',
          deltaValue: delta,
          appliedDelta: delta,
          balanceAfter,
          reason,
          dateTime: endDateTime
        });

        await Student.updateOne({ _id: student._id }, { $inc: { totalSp: delta } });

        const pollResponses = responses.map(r => ({
          pollName: r.topic || sessionLabel,
          question: r.question || '',
          response: r.answer || '',
          attempted: Boolean(r.answer && r.answer.trim() !== '')
        }));

        await PollRecord.findOneAndUpdate(
          { email: email.toLowerCase(), sessionLabel },
          {
            $set: {
              email: email.toLowerCase(),
              studentId: student._id,
              sessionLabel,
              totalQuestions,
              attemptedQuestions: attempted,
              missedQuestions: missed,
              responses: pollResponses,
              transactionId: tx._id
            }
          },
          { upsert: true }
        );

        stats.pollRecords++;
      } else {
        stats.pollRecords++;
      }
    }
  }

  await mongoose.disconnect();

  console.log(`\n✅ Ingestion complete for ${sessionLabel}`);
  console.log(`   Attendance records: ${stats.attendance}`);
  console.log(`   Poll records: ${stats.pollRecords}`);
  console.log(`   Skipped (already exists): ${stats.skipped}`);

  return { success: true, sessionLabel, stats };
}

/**
 * Ingest multiple dates — finds all dates that have zoom meeting data
 * but haven't been ingested yet.
 */
export async function ingestAllMissingDates(options = {}) {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  // Get all distinct dates in zoom_meetings
  const dates = await db.collection('zoom_meetings').distinct('date');
  dates.sort();

  console.log(`Found zoom meeting data for dates: ${dates.join(', ')}`);

  const results = [];
  for (const dateStr of dates) {
    const sessionLabel = buildSessionLabel(dateStr);
    const alreadyDone = await isSessionIngested(sessionLabel);
    if (alreadyDone && !options.force) {
      console.log(`\nSkipping ${sessionLabel} — already ingested`);
      continue;
    }
    console.log(`\n${'='.repeat(50)}`);
    await mongoose.disconnect();
    const result = await ingestZoomSession(dateStr, options);
    results.push(result);
  }

  return results;
}
