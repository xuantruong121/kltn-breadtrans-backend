const BASE_URL = 'http://localhost:3001';

async function runSecurityTests() {
  console.log('=== STARTING COMPLETE CROSS-OWNERSHIP & SECURITY TESTS (X01 - X08) ===\n');

  // 1. Authenticate Teacher A (teacher1@breadtrans.com)
  console.log('Authenticating Teacher A (teacher1@breadtrans.com)...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@breadtrans.com',
      password: '123456',
    }),
  });

  const loginData: any = await loginRes.json();
  const token =
    loginData?.data?.access_token ||
    loginData?.data?.accessToken ||
    loginData?.access_token;
  if (!token) {
    throw new Error(
      'Failed to retrieve access_token for Teacher A: ' + JSON.stringify(loginData),
    );
  }
  console.log('Teacher A authenticated successfully.\n');

  // 2. Authenticate Student (student3@breadtrans.com - ID 47, not enrolled in Class 18)
  console.log('Authenticating Student (student3@breadtrans.com)...');
  const studentLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'student3@breadtrans.com',
      password: '123456',
    }),
  });
  const studentLoginData: any = await studentLoginRes.json();
  const studentToken =
    studentLoginData?.data?.access_token ||
    studentLoginData?.data?.accessToken ||
    studentLoginData?.access_token;
  if (!studentToken) {
    throw new Error(
      'Failed to retrieve access_token for Student: ' + JSON.stringify(studentLoginData),
    );
  }
  console.log('Student authenticated successfully.\n');

  const teacherHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const studentHeaders = {
    Authorization: `Bearer ${studentToken}`,
    'Content-Type': 'application/json',
  };

  const results: any[] = [];

  // X01. PATCH /courses/:id (Course 15 belongs to Teacher B - ID 42)
  console.log('Running X01: PATCH /courses/15 (Teacher B course)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/15`, {
      method: 'PATCH',
      headers: teacherHeaders,
      body: JSON.stringify({ description: 'Hacked by Teacher A' }),
    });
    const data: any = await res.json();
    results.push({
      id: 'X01',
      name: 'Teacher A edits Teacher B Course',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X01',
      name: 'Teacher A edits Teacher B Course',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X02. PATCH /courses/classes/:id (Class 18 belongs to Teacher B - ID 42)
  console.log('Running X02: PATCH /courses/classes/18 (Teacher B class)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/classes/18`, {
      method: 'PATCH',
      headers: teacherHeaders,
      body: JSON.stringify({ name: 'Hacked Class Name' }),
    });
    const data: any = await res.json();
    results.push({
      id: 'X02',
      name: 'Teacher A edits Teacher B Class',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X02',
      name: 'Teacher A edits Teacher B Class',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X03. POST /classes/:classId/sessions (Class 18 belongs to Teacher B)
  console.log('Running X03: POST /classes/18/sessions (Teacher B class)...');
  try {
    const res = await fetch(`${BASE_URL}/classes/18/sessions`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({
        title: 'Unauthorized Session by Teacher A',
        startTime: '2026-10-01T08:00:00.000Z',
        endTime: '2026-10-01T10:00:00.000Z',
      }),
    });
    const data: any = await res.json();
    results.push({
      id: 'X03',
      name: 'Teacher A creates Session in Teacher B Class',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X03',
      name: 'Teacher A creates Session in Teacher B Class',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X04. DELETE /classes/sessions/:sessionId (Session 37 in Class 18 of Teacher B)
  console.log('Running X04: DELETE /classes/sessions/37 (Teacher B session)...');
  try {
    const res = await fetch(`${BASE_URL}/classes/sessions/37`, {
      method: 'DELETE',
      headers: teacherHeaders,
    });
    const data: any = await res.json();
    results.push({
      id: 'X04',
      name: 'Teacher A deletes Session of Teacher B Class',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X04',
      name: 'Teacher A deletes Session of Teacher B Class',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X05. POST /courses/:id/revert-to-draft on Course 13 (has ONGOING classes)
  console.log('Running X05: POST /courses/13/revert-to-draft (Course with ONGOING classes)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/13/revert-to-draft`, {
      method: 'POST',
      headers: teacherHeaders,
    });
    const data: any = await res.json();
    results.push({
      id: 'X05',
      name: 'Teacher A reverts Course with ONGOING classes to DRAFT',
      expectedStatus: 400,
      actualStatus: res.status,
      passed: res.status === 400,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X05',
      name: 'Teacher A reverts Course with ONGOING classes to DRAFT',
      expectedStatus: 400,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X06. GET /courses/classes/18 (Student not enrolled in Class 18)
  console.log('Running X06: GET /courses/classes/18 (Student not enrolled)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/classes/18`, {
      method: 'GET',
      headers: studentHeaders,
    });
    const data: any = await res.json();
    const leaked = Boolean(data?.course?.lessons || data?.lessons || data?.materials);
    results.push({
      id: 'X06',
      name: 'Student bypasses enrollment via GET /courses/classes/:id',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403 && !leaked,
      message: data.message + (leaked ? ' [WARNING: DATA LEAKED]' : ' [No data leak]'),
    });
  } catch (err: any) {
    results.push({
      id: 'X06',
      name: 'Student bypasses enrollment via GET /courses/classes/:id',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X07. POST /courses/classes/18/assignments (Teacher A on Teacher B Class)
  console.log('Running X07: POST /courses/classes/18/assignments (Teacher A)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/classes/18/assignments`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({
        title: 'Hacked Assignment by Teacher A',
        description: 'Unauthorized assignment',
        type: 'ESSAY',
      }),
    });
    const data: any = await res.json();
    results.push({
      id: 'X07',
      name: 'Teacher A creates Assignment in Teacher B Class',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X07',
      name: 'Teacher A creates Assignment in Teacher B Class',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  // X08. PUT /courses/submissions/15/grade (Teacher A on submission of Teacher B Class)
  console.log('Running X08: PUT /courses/submissions/15/grade (Teacher A)...');
  try {
    const res = await fetch(`${BASE_URL}/courses/submissions/15/grade`, {
      method: 'PUT',
      headers: teacherHeaders,
      body: JSON.stringify({
        grade: 10,
        feedback: 'Graded by unauthorized Teacher A',
      }),
    });
    const data: any = await res.json();
    results.push({
      id: 'X08',
      name: 'Teacher A grades Submission of Teacher B Class',
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      message: data.message,
    });
  } catch (err: any) {
    results.push({
      id: 'X08',
      name: 'Teacher A grades Submission of Teacher B Class',
      expectedStatus: 403,
      actualStatus: 'FETCH_ERROR',
      passed: false,
      message: err.message,
    });
  }

  console.log('\n=== TEST RESULTS SUMMARY (X01 - X08) ===');
  console.table(results);

  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    console.log('\n>>> ALL 8 CROSS-OWNERSHIP & SECURITY TEST SCENARIOS PASSED (100%) <<<');
  } else {
    console.error('\n>>> SOME SECURITY TESTS FAILED <<<');
    process.exit(1);
  }
}

runSecurityTests().catch((e) => {
  console.error('Fatal error running security tests:', e);
  process.exit(1);
});
