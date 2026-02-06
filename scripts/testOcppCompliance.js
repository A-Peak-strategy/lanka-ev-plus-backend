import { isChargerOnline, getChargerConnection } from '../src/ocpp/ocppServer.js';
import { sendCall } from '../src/ocpp/messageQueue.js';
import { CStoCPAction } from '../src/ocpp/ocppConstants.js';

async function testOcppCompliance(chargerId) {
    console.log(`🔍 Testing OCPP 1.6 compliance for ${chargerId}\n`);

    if (!isChargerOnline(chargerId)) {
        console.log('❌ Charger offline, cannot test');
        return false;
    }

    const ws = getChargerConnection(chargerId);
    const tests = [];

    // Test 1: Trigger Heartbeat
    try {
        console.log('1. Testing TriggerMessage (Heartbeat)...');
        const heartbeatResponse = await sendCall(
            ws,
            chargerId,
            CStoCPAction.TRIGGER_MESSAGE,
            { requestedMessage: 'Heartbeat' },
            { timeout: 10000 }
        );
        tests.push({ name: 'TriggerMessage', passed: true, response: heartbeatResponse });
        console.log('   ✅ Heartbeat triggered successfully');
    } catch (error) {
        tests.push({ name: 'TriggerMessage', passed: false, error: error.message });
        console.log(`   ❌ Failed: ${error.message}`);
    }

    // Test 2: Get Configuration
    try {
        console.log('2. Testing GetConfiguration...');
        const configResponse = await sendCall(
            ws,
            chargerId,
            CStoCPAction.GET_CONFIGURATION,
            { key: ['HeartbeatInterval', 'MeterValueSampleInterval'] },
            { timeout: 10000 }
        );
        tests.push({ name: 'GetConfiguration', passed: true, response: configResponse });
        console.log('   ✅ Configuration retrieved');
        console.log(`   Configuration:`, JSON.stringify(configResponse.configurationKey, null, 2));
    } catch (error) {
        tests.push({ name: 'GetConfiguration', passed: false, error: error.message });
        console.log(`   ❌ Failed: ${error.message}`);
    }

    // Test 3: Change Configuration (read-only parameter should be rejected)
    try {
        console.log('3. Testing ChangeConfiguration (should reject read-only)...');
        const changeResponse = await sendCall(
            ws,
            chargerId,
            CStoCPAction.CHANGE_CONFIGURATION,
            { key: 'NumberOfConnectors', value: '2' },
            { timeout: 10000 }
        );
        tests.push({
            name: 'ChangeConfiguration',
            passed: changeResponse.status === 'Rejected' || changeResponse.status === 'NotSupported',
            response: changeResponse
        });
        console.log(`   ✅ Response: ${changeResponse.status} (expected Rejected/NotSupported for read-only)`);
    } catch (error) {
        tests.push({ name: 'ChangeConfiguration', passed: false, error: error.message });
        console.log(`   ❌ Failed: ${error.message}`);
    }

    // Summary
    console.log('\n📊 Test Summary:');
    const passed = tests.filter(t => t.passed).length;
    const total = tests.length;

    tests.forEach(test => {
        const icon = test.passed ? '✅' : '❌';
        console.log(`  ${icon} ${test.name}: ${test.passed ? 'PASSED' : 'FAILED'}`);
        if (!test.passed && test.error) {
            console.log(`     Error: ${test.error}`);
        }
    });

    console.log(`\n🎯 Result: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);

    return passed === total;
}

// Run test if called directly
if (process.argv[2]) {
    testOcppCompliance(process.argv[2]).then(success => {
        process.exit(success ? 0 : 1);
    });
}