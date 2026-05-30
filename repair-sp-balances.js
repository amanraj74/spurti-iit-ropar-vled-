/**
 * repair-sp-balances.js
 * 
 * Recomputes balanceAfter on every SPTransaction and syncs Student.totalSp
 * to match the true running balance from the transaction log.
 * 
 * Run once to fix historical imbalances.
 */

import mongoose from 'mongoose';
import Student from './server/models/Student.js';
import SPTransaction from './server/models/SPTransaction.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://sakshi:iitropar@127.0.0.1:27017/sakshi_spurti?authSource=sakshi_spurti';

async function repair() {
  await mongoose.connect(MONGO_URI);
  
  console.log('🔧 Repairing SP balances...\n');

  // Get all unique emails with transactions
  const emails = await SPTransaction.distinct('email');
  console.log(`Students to repair: ${emails.length}`);

  let fixedTxns = 0;
  let fixedStudents = 0;
  let unchanged = 0;

  for (const email of emails) {
    const txns = await SPTransaction.find({ email })
      .sort({ dateTime: 1, createdAt: 1 })
      .lean();

    if (txns.length === 0) continue;

    // Recompute running balance
    let running = 0;
    let hasChanges = false;

    for (const txn of txns) {
      running += txn.appliedDelta;
      if (txn.balanceAfter !== running) {
        await SPTransaction.updateOne({ _id: txn._id }, { $set: { balanceAfter: running } });
        fixedTxns++;
        hasChanges = true;
      }
    }

    // Get the final computed balance
    const finalBalance = running;

    // Update student.totalSp
    const student = await Student.findOne({ email });
    if (student && student.totalSp !== finalBalance) {
      const diff = finalBalance - (student.totalSp || 0);
      console.log(`  ${email.slice(0,40)}: totalSp ${student.totalSp} → ${finalBalance} (diff: ${diff >= 0 ? '+' : ''}${diff})`);
      await Student.updateOne({ _id: student._id }, { $set: { totalSp: finalBalance } });
      fixedStudents++;
    } else if (student) {
      unchanged++;
    }
  }

  console.log(`\n✅ Repair complete`);
  console.log(`   Transactions fixed: ${fixedTxns}`);
  console.log(`   Students updated: ${fixedStudents}`);
  console.log(`   Students unchanged: ${unchanged}`);

  await mongoose.disconnect();
}

repair().catch(async (err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
