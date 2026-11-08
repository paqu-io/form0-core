import assert from 'node:assert/strict';
import { createFormEngine, SAFE_SECURITY_CONFIG } from '../src/index.js';
import { formSchema, numericField, repeatableSection } from './helpers/calculation-fixtures.js';

const create = (code, options = {}) =>
  createFormEngine({
    schema: formSchema([numericField('amount')], { events: { code } }),
    initialValues: { amount: 2 },
    diagnostics: { console: false },
    ...options,
  });

for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const engine = create(
    `ON('blur', 'amount', function() {
    MESSAGEBOX({title:'Question', buttons:[{id:'yes',label:'Oui'},'No'], input:true,
      context:{original:$amount}}, function(reply) {
      if (!reply.cancelled && reply.value === 'yes') SETVALUE('amount', $amount + reply.context.original);
    });
  });`,
    { security }
  );
  const first = engine.triggerDetailed('blur', 'amount');
  assert.deepEqual(first.issues, []);
  const request = structuredClone(first.operations[0]);
  assert.equal(request.params.buttons[0].id, 'yes');
  assert.equal('context' in request.params, false);
  engine.setValue('amount', 5);
  assert.equal(
    engine.resolveUIRequest(request.params.requestId, { value: 'missing', input: '' }).issues
      .length,
    1
  );
  const reply = engine.resolveUIRequest(request.params.requestId, { value: 'yes', input: 'text' });
  assert.deepEqual(reply.issues, []);
  assert.equal(reply.operations[0].params.valueToSet, 7);
  assert.equal(
    engine.getState().values.amount,
    5,
    'core returns operations without applying writes'
  );
  assert.equal(
    engine.resolveUIRequest(request.params.requestId, { value: 'yes', input: '' }).issues.length,
    1
  );

  const cancelled = engine.triggerDetailed('blur', 'amount').operations[0];
  assert.deepEqual(
    engine.resolveUIRequest(cancelled.params.requestId, { cancelled: true }).operations,
    []
  );
  const stale = engine.triggerDetailed('blur', 'amount').operations[0];
  engine.setMode('readonly');
  assert.equal(
    engine.resolveUIRequest(stale.params.requestId, { value: 'No', input: '' }).issues.length,
    1
  );
}

for (const event of ['validate-record', 'cancel-record', 'unload-record']) {
  const engine = create(
    `ON('${event}', function() { MESSAGEBOX({buttons:['OK']},function(){}); });`
  );
  assert.equal(engine.triggerDetailed(event).issues[0].code, 'operation_not_allowed');
}

{
  const engine = create(`ON('blur','amount',function(){
    MESSAGEBOX({buttons:['OK'],context:{keep:4}},function(r){
      MESSAGEBOX({buttons:['Next'],context:r.context},function(next){SETVALUE('amount', next.context.keep);});
    });
  });`);
  const first = engine.triggerDetailed('blur', 'amount').operations[0];
  const next = engine.resolveUIRequest(first.params.requestId, { value: 'OK' }).operations[0];
  assert.equal(
    engine.resolveUIRequest(next.params.requestId, { value: 'Next' }).operations[0].params
      .valueToSet,
    4
  );
  const closing = engine.triggerDetailed('blur', 'amount').operations[0];
  engine.cancelUIRequests();
  assert.equal(engine.resolveUIRequest(closing.params.requestId, { value: 'OK' }).issues.length, 1);
}

{
  const schema = formSchema(
    [numericField('main'), repeatableSection('rows', [numericField('amount')])],
    {
      events: {
        code: `ON('blur','amount',function(){MESSAGEBOX({buttons:['OK']},function(){SETVALUE('main',99);});});`,
      },
    }
  );
  const engine = createFormEngine({
    schema,
    initialValues: { main: 1, amount: 2 },
    eventScope: {
      instancePath: [{ repeatableKey: 'rows', instanceId: 'r1', index: 0, identity: 'id' }],
    },
  });
  const request = engine.triggerDetailed('blur', 'amount').operations[0];
  const result = engine.resolveUIRequest(request.params.requestId, { value: 'OK' });
  assert.equal(result.issues[0].code, 'write_scope_restricted');
  assert.deepEqual(result.operations, []);
}

{
  const engine = create(`ON('blur','amount',function(){
    MESSAGEBOX({buttons:['OK']},function(){SETVALUE('amount',7);});
    SETVALUE('missing', 3);
  });`);
  assert.deepEqual(engine.triggerDetailed('blur', 'amount').operations, []);
  assert.equal(engine.eventManager, undefined);
  const legacy = create(
    `ON('blur','amount',function(){ MESSAGEBOX({buttons:['OK']},function(){ALERT('Done');}); });`
  );
  const operation = legacy.trigger('blur', 'amount')[0];
  assert.ok(operation.params.requestId);
  assert.equal(
    legacy.resolveUIRequest(operation.params.requestId, { value: 'OK' }).operations[0].operation,
    'ALERT'
  );
}
console.log('MESSAGEBOX lifecycle, scope, portable context and security tests passed.');

{
  const original = Function.prototype.toString;
  try {
    Function.prototype.toString = function () {
      return 'function () { [native code] }';
    };
    const engine = create(
      `ON('blur','amount',function(){MESSAGEBOX({buttons:['OK'],context:{original:$amount}},function(reply){SETVALUE('amount',$amount+reply.context.original);});});`
    );
    const request = engine.triggerDetailed('blur', 'amount').operations[0];
    engine.setValue('amount', 8);
    const result = engine.resolveUIRequest(request.params.requestId, { value: 'OK' });
    assert.deepEqual(result.issues, []);
    assert.equal(result.operations[0].params.valueToSet, 10);
  } finally {
    Function.prototype.toString = original;
  }
}
