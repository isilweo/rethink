import F_V8_Y___W_B_2QEUK from './F_V8_Y___W.B_2QEUK'
import { ERRORS, TEMPERATURES, SPINS, SMART_COURSES } from './washer_common'
import { Enum } from '@/util/enum'

// F_V__Y___W.B_2QEUK units come in two firmware flavours. Some send F_V8_Y___W.B_2QEUK's 39-byte
// record and are handled exactly like it (TW4V9RW9W was added as a plain alias). Others - an 8.5 kg
// "Vivace VC2" (clip_hna_v1.9.237, RTK module) - send a 32-byte record under the same 0x20 EB/EC
// framing, which the F_V8 handler rejects. The short record keeps the F_V8 / Y_V8_Y___W.B32QEUK
// field order but carries no energy counter.
const SHORT_STATUS_LENGTH = 32

// The thirteen courses of this model's modelJson, under its own names (the same set and codes as
// Y_V8_Y___W.B32QEUK's dial, with Silent Wash in place of AI Wash). All but Easy Care were confirmed
// by turning the dial on a real unit and matching the panel; Easy Care was skipped over in the
// capture and is taken from the sibling's sweep. The "My Programme" dial position reports the
// downloaded course's base course here (Blanket -> Duvet) and the downloaded course in rec[22].
const COURSES = Enum.of({
    Cotton: 0x01,
    'Easy Care': 0x02,
    'Eco 40-60': 0x04,
    Duvet: 0x05,
    Mix: 0x07,
    'Sports Wear': 0x08,
    'Silent Wash': 0x09,
    'Speed 14': 0x0c,
    'Tub Clean': 0x12,
    Wool: 0x1b,
    Delicate: 0x20,
    'Allergy SpaSteam': 0x2d,
    'Turbo Wash 39': 0x31,
})

// Same codes as F_V8 and this model's modelJson `state` enum.
const STATUS = Enum.of({
    Off: 0,
    Standby: 1,
    Paused: 2,
    Delayed: 3,
    Detecting: 4,
    Washing: 6,
    Rinsing: 7,
    Spinning: 8,
    Drying: 9,
    End: 10,
    'Cool down': 11,
    'Rinse hold': 12,
    Refreshing: 14,
    'Steam softening': 15,
    Demo: 16,
    Error: 18,
})

export default class Device extends F_V8_Y___W_B_2QEUK {
    processAABB(buf: Buffer) {
        if (this.processCommonStatus(buf, 0x20, SHORT_STATUS_LENGTH, this.processShortStatus)) return
        super.processAABB(buf)
    }

    // Offsets into the 32-byte record (rec[0:2] = 00 1f, unused). Checked against a unit driven from
    // its panel while filmed, and against the LG cloud's state and modelJson for the model:
    //   [2]      status         Off/Standby/Washing/Paused seen, codes as modelJson's `state`
    //   [3][4]   remaining time h:m, [5][6] initial time h:m - both equal the panel's estimate while idle
    //   [7]      course         see COURSES
    //   [8]      error          0 throughout; position and codes as F_V8 / modelJson `error`
    //   [9]      soil wash      3 (Normal) whenever a course is set, never changed in the capture
    //   [10]     spin, [11] temp - each step on the panel matched
    //   [12]     rinse          1 (Normal) throughout
    //   [14]     Delay End hours (3, 4 as on the panel); [15] stays 0
    //   [16]     options        0x01 TurboWash (also lit by default on Speed 14 / Turbo Wash 39), 0x80 Steam
    //   [17]     lock/remote-start bits in F_V8; 0 throughout here, so door/child lock and remote start
    //            are not published from this record until a unit is seen setting them
    //   [18]     bit 0 follows the AI DD icon (Cotton, Mix); 0x20 once at the start of a wash
    //   [21]     preState, the status this record supersedes
    //   [22]     downloaded course while the dial is on "My Programme", else 0
    //   [23]     58 = the cloud's TCLCount (washes since tub clean), not a cycle count; [25] the same
    // [30][31]  F_V8's energy counter; 0 here while the cloud reported 343 Wh, so energy is not published.
    processShortStatus(rec: Buffer) {
        const status = rec[2]
        const time_remain = rec[3] * 60 + rec[4]
        const time_initial = rec[5] * 60 + rec[6]
        const course = rec[7]
        const error = rec[8]
        const spin = rec[10]
        const temp = rec[11]
        const time_reserve_hour = rec[14]
        const options = rec[16]
        const smart_course = rec[22]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATUS.map(status))
        // On "My Programme" the base course would read e.g. Duvet for Blanket, so the downloaded
        // course is what the user actually picked.
        const courseName = smart_course ? SMART_COURSES.map(smart_course) : COURSES.map(course)
        if (course && courseName === undefined)
            this.log('undecoded course', course.toString(16), smart_course.toString(16))
        this.publishProperty('course', courseName)
        this.publishProperty('spin', SPINS.map(spin))
        this.publishProperty('temp', TEMPERATURES.map(temp))
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        this.publishProperty('reserve_time', time_reserve_hour)
        this.publishProperty('turbowash', options & 0x01 ? 'ON' : 'OFF')
        this.publishProperty('steam', options & 0x80 ? 'ON' : 'OFF')
    }
}
