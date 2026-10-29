import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/F_V__Y___W.B_2QEUK'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'F_V__Y___W.B_2QEUK'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '0.0.0' }

// REAL frames from an LG F2WV9S8P2E unit (clip_hna_v1.9.237) bridged through rethink on 2026-10-29
// while its panel was driven and filmed; the comments say what the panel showed. All carry the
// 32-byte record.

// Reply to the F0ED status request: on, no course selected yet.
const EB_STANDBY = buf('AA2620EB001F0100000000000000000000000000000000000000003A003A0000000000003ABB')
// Power button: Standby -> Off.
const POWER_OFF = buf(
    'AA4620EC001F0100000000000000000000000000000000000000003A003A000000000000001F0000000000000000000000000000000000000001003A003A00000000000071BB',
)
// Dial: Delicate, 0:45, 20 °C, 800 rpm.
const COURSE_DELICATE = buf(
    'AA4620EC001F0100000000000000000000000000000000000000003A003A000000000000001F01002D002D200003050201000000000000000100003A003A000003000000F8BB',
)
// Dial: Speed 14, 0:14, 20 °C, 400 rpm, TurboWash lit by default.
const COURSE_SPEED_14 = buf(
    'AA4620EC001F0100340034080003050401000000000000000200003A003A000002000000001F01000E000E0C0003020201000000010000000000003A003A00000100000082BB',
)
// Dial: My Programme holding the downloaded Blanket course (base course Duvet), 1:28, 400 rpm.
const COURSE_MY_PROGRAMME = buf(
    'AA4620EC001F01010C010C120003010601000000000000000300003A003A000002000000001F01011C011C0500030201010000000000000001003A3A003A000003000000B1BB',
)
// Dial: Allergy SpaSteam, 2:45, 60 °C, 1200 rpm, Steam on.
const COURSE_ALLERGY = buf(
    'AA4620EC001F01011C011C0500030201010000000000000001003A3A003A000003000000001F01022D022D2D0003090601000000800000000400003A003A0000050000009ABB',
)
// Cotton 60 °C 1000 rpm with Steam and TurboWash, then Delay End pressed: 3 h.
const COTTON_DELAY_3H = buf(
    'AA4620EC001F0102220222010003070601000000810001000300003A003A000004000000001F0102220222010003070601000300810001000300003A003A000004000000B8BB',
)
// Start pressed on Speed 14: Standby -> Washing.
const START_WASHING = buf(
    'AA4620EC001F01000E000E0C0003020201000000010000000000003A003A000001000000001F06000E000E0C0003020201000000010020000101003A003A000001000000FABB',
)
// Pause pressed: Washing -> Paused.
const PAUSE = buf(
    'AA4620EC001F06000E000E0C0003020201000000010020000101003A003A000001000000001F02000E000E0C0003020201000000010000000006003A003A000001000000E3BB',
)
// Power button while paused: Paused -> Off; the times stay, the settings clear.
const OFF_AFTER_PAUSE = buf(
    'AA4620EC001F02000E000E0C0003020201000000010000000006003A003A000001000000001F00000E000E0C0000000000000000000000000002003A003A000001000000D2BB',
)

// F_V8's 39-byte record (from its own tests), which other F_V__Y___W.B_2QEUK units send.
const LONG_RECORD_COTTON = buf(
    'aa5420ec002501000000000000000000000000000000000000000001006400000000000000000000000000002501033a033a0100030b04010000000000010002000001006400000400000000000000000000e0bb',
)

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('0xEB reply decodes Standby with nothing selected', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', EB_STANDBY)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.power, 'ON')
        assert.equal(props.status, 'Standby')
        assert.equal(props.course, 'None')
        assert.equal(props.remaining_time, 0)
        assert.equal(props.error, 'OFF')
        assert.equal(props.error_message, 'OK')
    })

    test('power off reads Off', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', POWER_OFF)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.power, 'OFF')
        assert.equal(props.status, 'Off')
    })

    test('dial positions decode course, time, temperature and spin', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', COURSE_DELICATE)
        let props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Delicate')
        assert.equal(props.remaining_time, 45)
        assert.equal(props.initial_time, 45)
        assert.equal(props.temp, '20 °C')
        assert.equal(props.spin, '800 rpm')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.steam, 'OFF')

        thinq.emit('data', COURSE_SPEED_14)
        props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Speed 14')
        assert.equal(props.remaining_time, 14)
        assert.equal(props.spin, '400 rpm')
        assert.equal(props.turbowash, 'ON')

        thinq.emit('data', COURSE_ALLERGY)
        props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Allergy SpaSteam')
        assert.equal(props.remaining_time, 165)
        assert.equal(props.temp, '60 °C')
        assert.equal(props.spin, '1200 rpm')
        assert.equal(props.steam, 'ON')
    })

    test('My Programme reports the downloaded course rather than its base course', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', COURSE_MY_PROGRAMME)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Blanket')
        assert.equal(props.remaining_time, 88)
    })

    test('Steam, TurboWash and Delay End', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', COTTON_DELAY_3H)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Cotton')
        assert.equal(props.temp, '60 °C')
        assert.equal(props.spin, '1000 rpm')
        assert.equal(props.steam, 'ON')
        assert.equal(props.turbowash, 'ON')
        assert.equal(props.reserve_time, 3)
        assert.equal(props.remaining_time, 154)
    })

    test('start, pause and power off', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', START_WASHING)
        let props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Washing')
        assert.equal(props.course, 'Speed 14')
        assert.equal(props.remaining_time, 14)

        thinq.emit('data', PAUSE)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Paused')

        thinq.emit('data', OFF_AFTER_PAUSE)
        props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Off')
        assert.equal(props.power, 'OFF')
        assert.equal(props.course, 'Speed 14') // the course byte survives power off
        assert.equal(props.temp, 'Not selected')
        assert.equal(props.spin, 'Not selected')
    })

    test('the short record leaves the unconfirmed F_V8 entities unpublished', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', START_WASHING)
        const props = ha.devices[DEVICE_ID].properties
        for (const prop of ['door_lock', 'child_lock', 'remote_start', 'energy', 'cycles', 'soil', 'prewash']) {
            assert.equal(props[prop], undefined, prop)
        }
    })

    test("F_V8's 39-byte record is still decoded as F_V8", () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', LONG_RECORD_COTTON)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Cotton')
        assert.equal(props.spin, '1600 rpm')
        assert.equal(props.temp, '40 °C')
        assert.equal(props.door_lock, 'ON')
    })
})
