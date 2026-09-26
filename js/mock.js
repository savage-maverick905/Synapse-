/* Synapse · mock.js
   A small hand-written sample course that follows the real course schema.
   It lets you explore the reader, PDF and ZIP export without an API key,
   and doubles as a fixture for testing the renderers. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});

  const raw = {
    title: 'Your First Arduino Robot',
    subtitle: 'From how machines sense the world to a robot that avoids walls',
    description:
      'A hands-on introduction to robotics for complete beginners. You will learn how robots sense, decide and act, pick up just enough electronics to wire things safely, and write the Arduino programs that bring a small distance-sensing robot to life.',
    level: 'Beginner',
    objectives: [
      'Explain the sense–think–act loop that every robot follows.',
      "Use Ohm's law to choose a safe resistor for an LED.",
      'Write, upload and modify a basic Arduino program.',
      'Wire and read an HC-SR04 ultrasonic distance sensor.',
      'Combine sensing and decisions into a robot that avoids obstacles.',
    ],
    prerequisites: ['No electronics or programming experience needed.', 'An Arduino Uno (or compatible) board and a USB cable for the practical parts.'],
    modules: [
      {
        title: 'How a robot works',
        description: 'The core ideas behind every robot, and the small amount of electricity you need to build one safely.',
        lessons: [
          {
            title: 'Sense, think, act',
            content:
              "Every robot, from a vacuum cleaner to a Mars rover, runs the same loop. It **senses** something about the world, **thinks** about what that means, and **acts** on the decision. Then it senses again, because its action changed the world.\n\n" +
              "### The three parts\n\n" +
              "A *sensor* turns something physical (light, distance, temperature) into an electrical signal. A *controller* is a small computer that reads those signals and runs your program. An *actuator* turns a signal back into physical motion, such as a motor spinning or a servo turning.\n\n" +
              "| Part | Job | Examples |\n| :-- | :-- | :-- |\n| Sensor | Measures the world | Ultrasonic sensor, light sensor, button |\n| Controller | Decides what to do | Arduino Uno, Raspberry Pi Pico |\n| Actuator | Changes the world | DC motor, servo, buzzer, LED |\n\n" +
              "### Why the loop matters\n\n" +
              "A robot never plans a whole journey in advance. It repeats the loop many times a second, making tiny corrections. A line-following robot does not *know* the shape of the track; it only checks \"am I on the line?\" again and again, and steers a little each time. This is called **feedback**, and it is why simple robots can behave in surprisingly clever ways.\n\n" +
              "> **Definition:** A *feedback loop* is a process where the result of an action is measured and used to decide the next action.",
            keyPoints: [
              'A robot repeats sense → think → act, many times per second.',
              'Sensors input, controllers decide, actuators output.',
              'Feedback lets a simple program handle a messy, changing world.',
            ],
            examples: [
              {
                title: 'A robot vacuum meets a chair leg',
                body: 'The bump sensor **senses** contact. The controller **thinks**: "obstacle on the left, so turn right". The motors **act** by rotating the robot. On the next pass through the loop the sensor no longer reports contact, so the robot carries on forward.',
              },
            ],
            exercise: {
              prompt: 'Pick a machine in your home (a microwave, a thermostat, an automatic door). Write down which parts sense, which think and which act. Then decide: does it have a feedback loop?',
              hint: "Ask what the machine measures, and what it changes because of that measurement.",
            },
            reflection: ['Why could a robot with a poor sensor still work well if it loops fast enough?'],
            quiz: {
              questions: [
                { question: 'Which part of a robot turns an electrical signal into motion?', options: ['Sensor', 'Controller', 'Actuator', 'Battery'], answerIndex: 2, explanation: 'Actuators, such as motors and servos, convert signals into physical action.' },
                { question: 'What does "feedback" mean in robotics?', options: ['Sending sensor data to a phone', 'Using the result of an action to decide the next action', 'A loud noise from the motors', 'Recording video of the robot'], answerIndex: 1, explanation: 'Feedback closes the loop: the outcome is measured and influences what happens next.' },
                { question: 'A thermostat measures room temperature and switches a heater on or off. Which part is the sensor?', options: ['The heater', 'The temperature probe', 'The wall switch', 'The wire'], answerIndex: 1, explanation: 'The probe measures the physical world; the heater is the actuator.' },
              ],
            },
            images: [
              {
                type: 'diagram',
                description: 'The sense, think, act loop that a robot repeats continuously.',
                caption: 'The robot control loop. The world changes after every action, so the loop starts again.',
                diagram: { kind: 'cycle', center: 'Robot', nodes: [{ label: 'Sense the world' }, { label: 'Think (run program)' }, { label: 'Act (move motors)' }, { label: 'World changes' }] },
              },
            ],
          },
          {
            title: 'Electricity for robot builders',
            content:
              "You do not need to be an electrical engineer to build a robot, but three ideas will keep your parts safe and your circuits working.\n\n" +
              "### Voltage, current and resistance\n\n" +
              "**Voltage** (volts, V) is the push that moves charge, like water pressure. **Current** (amps, A) is how much charge flows past a point each second, like the flow rate. **Resistance** (ohms, Ω) is how much a part resists that flow, like a narrow pipe. Ohm's law ties them together:\n\n" +
              "```equation\nV = I \\times R\n```\n\n" +
              "An LED is a good example. A typical red LED wants about 2 V and 20 mA. If you connect it straight to the Arduino's 5 V pin, far too much current flows and the LED burns out in a moment. A resistor absorbs the extra voltage. The voltage to absorb is 5 V − 2 V = 3 V, so the resistor needed is $R = V / I = 3 / 0.02 = 150\\ \\Omega$. In practice you would pick the next standard value up, 220 Ω.\n\n" +
              "### Ground and common ground\n\n" +
              "Current needs a complete loop. Every part in your robot must share a common **ground (GND)**, otherwise signals have no reference and behave randomly. When two power sources are used (for example USB for the Arduino and a battery pack for the motors), connect their grounds together.\n\n" +
              "### Power budget\n\n" +
              "| Part | Typical current |\n| :-- | --: |\n| LED with resistor | 10–20 mA |\n| HC-SR04 sensor | 15 mA |\n| Small servo | 100–500 mA |\n| Small DC motor | 200–800 mA |\n\n" +
              "The Arduino's pins can safely provide only about 20 mA each. Motors must therefore be driven through a motor driver, powered separately.",
            keyPoints: ["Ohm's law: V = I × R.", 'Always put a resistor in series with an LED.', 'Join the grounds of separate power sources.', 'Never power motors directly from an Arduino pin.'],
            examples: [
              { title: 'Sizing an LED resistor for a 3.3 V board', body: 'A 3.3 V pin driving a 2 V LED at 10 mA: R = (3.3 − 2) / 0.010 = **130 Ω**. A standard 150 Ω resistor works and gives slightly less current, which is safer.' },
            ],
            exercise: {
              prompt: 'A green LED needs 2.2 V and 15 mA. You are using a 5 V supply. Calculate the minimum resistor value, then choose a standard value from this list: 100, 150, 180, 220, 330 Ω.',
              hint: 'Subtract the LED voltage from the supply first. That is the voltage the resistor must absorb.',
            },
            reflection: [],
            quiz: {
              questions: [
                { question: 'What is the resistor for an LED with a 5 V supply, a 2 V LED and 20 mA?', options: ['60 Ω', '150 Ω', '250 Ω', '3000 Ω'], answerIndex: 1, explanation: 'R = (5 − 2) / 0.02 = 150 Ω.' },
                { question: 'Why must separate power sources share a ground?', options: ['To make the battery last longer', 'So signals share a common reference', 'To reduce weight', 'It is only needed for motors'], answerIndex: 1, explanation: 'Voltages are only meaningful relative to a reference; a common ground provides it.' },
              ],
            },
            images: [
              {
                type: 'diagram',
                description: 'How power reaches the parts of a small robot through separate layers.',
                caption: 'A robot power stack: the battery feeds the driver and regulator, and only low-current signals come from the Arduino.',
                diagram: {
                  kind: 'layers',
                  layers: [
                    { label: 'Battery pack', detail: '6 V, feeds everything else' },
                    { label: 'Motor driver', detail: 'Switches high motor current' },
                    { label: 'Arduino controller', detail: 'Low-current logic signals only' },
                    { label: 'Sensors and LEDs', detail: 'Powered from the 5 V pin' },
                  ],
                },
              },
            ],
          },
        ],
        project: null,
      },
      {
        title: 'Your first Arduino program',
        description: 'Write, upload and understand the code that makes hardware respond, ending with a distance-sensing robot.',
        lessons: [
          {
            title: 'Blink: the hello world of hardware',
            content:
              "An Arduino program is called a **sketch**. Every sketch has two required functions. `setup()` runs once when the board powers on, and `loop()` runs over and over forever. That second function is the sense–think–act loop from Module 1, written in code.\n\n" +
              "```cpp\nconst int LED_PIN = 13;   // the built-in LED\n\nvoid setup() {\n  pinMode(LED_PIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_PIN, HIGH);  // LED on\n  delay(500);                    // wait 500 ms\n  digitalWrite(LED_PIN, LOW);   // LED off\n  delay(500);\n}\n```\n\n" +
              "### Reading the code\n\n" +
              "`pinMode` tells the Arduino whether a pin will send signals out (`OUTPUT`) or listen (`INPUT`). `digitalWrite` sets an output to `HIGH` (5 V) or `LOW` (0 V). `delay` pauses the program for a number of milliseconds. Change both delays to `100` and upload again: the LED blinks five times faster.\n\n" +
              "### Uploading\n\n" +
              "1. Connect the board with the USB cable.\n2. In the Arduino IDE choose your board and port from the *Tools* menu.\n3. Press the upload arrow. The board resets and starts your sketch.\n\nIf upload fails, the wrong port is selected in nine cases out of ten.",
            keyPoints: ['setup() runs once; loop() repeats forever.', 'pinMode chooses input or output.', 'digitalWrite switches an output HIGH or LOW.', 'delay() pauses in milliseconds.'],
            examples: [{ title: 'A double blink', body: 'Turn the LED on for 100 ms, off for 100 ms, on again for 100 ms, then off for 700 ms. Copy the on/off pair twice inside `loop()` and change the delays.' }],
            exercise: { prompt: 'Make the LED send the Morse code for "SOS": three short blinks, three long blinks, three short blinks, then a pause.', hint: 'Short can be 200 ms and long 600 ms. You can copy the on/off block as many times as you need.' },
            reflection: ['What would happen if you removed both delay() calls?'],
            quiz: {
              questions: [
                { question: 'Which function runs only once when the Arduino starts?', options: ['loop()', 'setup()', 'main()', 'start()'], answerIndex: 1, explanation: 'setup() runs once; loop() repeats.' },
                { question: 'What does delay(250) do?', options: ['Waits 250 seconds', 'Waits 250 milliseconds', 'Repeats 250 times', 'Sets pin 250 high'], answerIndex: 1, explanation: 'delay() takes milliseconds.' },
              ],
            },
            images: [
              {
                type: 'diagram',
                description: 'Program flow of an Arduino sketch.',
                caption: 'setup() runs once, then loop() runs forever.',
                diagram: {
                  kind: 'flow',
                  nodes: [{ id: 'p', label: 'Power on / reset' }, { id: 's', label: 'setup() runs once', group: 1 }, { id: 'l', label: 'loop() runs your code', group: 2 }, { id: 'r', label: 'Reaches the end', group: 2 }],
                  edges: [{ from: 'p', to: 's' }, { from: 's', to: 'l' }, { from: 'l', to: 'r' }, { from: 'r', to: 'l', label: 'starts again' }],
                },
              },
            ],
          },
          {
            title: 'Measuring distance with an ultrasonic sensor',
            content:
              "The HC-SR04 sensor measures distance the way a bat does. It sends out a burst of ultrasound, waits for the echo to return from an obstacle and measures how long that took. Sound travels at roughly 343 m/s in air, and the pulse travels there *and* back, so the distance is half of the trip:\n\n" +
              "```equation\ndistance = (time \\times 343) / 2\n```\n\n" +
              "In centimetres, with time in microseconds, this simplifies to `distance_cm = time_us × 0.0343 / 2`, or roughly `time_us / 58`.\n\n" +
              "### Wiring\n\n" +
              "| Sensor pin | Arduino pin |\n| :-- | :-- |\n| VCC | 5V |\n| GND | GND |\n| TRIG | 9 |\n| ECHO | 10 |\n\n" +
              "### The code\n\n" +
              "```cpp\nconst int TRIG = 9;\nconst int ECHO = 10;\n\nvoid setup() {\n  pinMode(TRIG, OUTPUT);\n  pinMode(ECHO, INPUT);\n  Serial.begin(9600);\n}\n\nlong readDistanceCm() {\n  digitalWrite(TRIG, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG, HIGH);      // 10 µs pulse starts a measurement\n  delayMicroseconds(10);\n  digitalWrite(TRIG, LOW);\n  long us = pulseIn(ECHO, HIGH, 30000);  // time out after 30 ms\n  return us / 58;\n}\n\nvoid loop() {\n  Serial.println(readDistanceCm());\n  delay(100);\n}\n```\n\n" +
              "Open the Serial Monitor at 9600 baud and move your hand in front of the sensor. Readings below 2 cm or above 400 cm, and readings of `0`, mean no reliable echo was received.\n\n" +
              "### Where it struggles\n\n" +
              "Soft materials such as clothing absorb ultrasound, and surfaces angled more than about 15° bounce the echo away from the sensor. A robot that relies only on this sensor may drive into a sofa cushion. That is a known limit, not a bug in your code.",
            keyPoints: ['Distance = time × speed of sound ÷ 2.', 'TRIG starts a measurement; ECHO returns the pulse length.', 'A reading of 0 means no valid echo.', 'Soft and angled surfaces confuse ultrasonic sensors.'],
            examples: [{ title: 'From echo to centimetres', body: 'An echo of 1160 µs: 1160 / 58 = **20 cm**. Check with the physics: 1160 µs × 0.0343 cm/µs = 39.8 cm for the round trip, and half is 19.9 cm.' }],
            exercise: { prompt: 'Extend the sketch so the built-in LED (pin 13) turns on whenever an obstacle is closer than 20 cm.', hint: 'Store the reading in a variable, then use an if statement with the > 0 and < 20 conditions together.' },
            reflection: ['Which surfaces would be hardest for your robot to detect, and why?'],
            quiz: {
              questions: [
                { question: 'Why is the round-trip time divided by two?', options: ['The sensor has two eyes', 'The sound travels to the object and back', 'To convert to centimetres', 'The Arduino runs at half speed'], answerIndex: 1, explanation: 'The echo covers the distance twice.' },
                { question: 'An echo of 580 µs corresponds to about:', options: ['1 cm', '10 cm', '100 cm', '580 cm'], answerIndex: 1, explanation: '580 / 58 = 10 cm.' },
                { question: 'Which object is the ultrasonic sensor most likely to miss?', options: ['A wooden wall facing the sensor', 'A metal can', 'A thick, soft curtain', 'A plastic box'], answerIndex: 2, explanation: 'Soft materials absorb ultrasound instead of reflecting it.' },
              ],
            },
            images: [
              {
                type: 'diagram',
                description: 'Signals between the Arduino and the ultrasonic sensor.',
                caption: 'How the Arduino and the HC-SR04 talk: a TRIG pulse out, an ECHO pulse back.',
                diagram: {
                  kind: 'flow',
                  nodes: [{ id: 'a', label: 'Arduino Uno', group: 0 }, { id: 's', label: 'HC-SR04 sensor', group: 1 }, { id: 'o', label: 'Obstacle', group: 2 }],
                  edges: [{ from: 'a', to: 's', label: 'TRIG pulse' }, { from: 's', to: 'o', label: 'ultrasound' }, { from: 'o', to: 'a', label: 'echo (ECHO pin)' }],
                },
              },
              {
                type: 'diagram',
                description: 'Comparison of two common obstacle sensors.',
                caption: 'Ultrasonic and infrared sensors fail in different ways.',
                diagram: {
                  kind: 'comparison',
                  columns: [
                    { title: 'Ultrasonic (HC-SR04)', points: ['Range about 2 to 400 cm', 'Works in sunlight', 'Misses soft, angled surfaces'] },
                    { title: 'Infrared (Sharp)', points: ['Range about 10 to 80 cm', 'Struggles in bright sunlight', 'Narrow, precise beam'] },
                  ],
                },
              },
            ],
          },
        ],
        project: {
          title: 'The wall-shy robot',
          brief: 'Build a small wheeled robot that drives forward until it senses something closer than 20 cm, then backs up and turns before carrying on.',
          steps: [
            'Mount the Arduino, HC-SR04 and a two-motor driver on a chassis.',
            'Wire the sensor exactly as in the last lesson and test it in the Serial Monitor.',
            'Wire the motor driver to the Arduino and power the motors from a separate battery pack with a shared ground.',
            'Write functions forward(), backward() and turnRight().',
            'In loop(), read the distance; if it is under 20 cm, back up for 400 ms and turn for 500 ms, otherwise go forward.',
            'Tune the times and the threshold until it avoids your test obstacles reliably.',
          ],
          deliverable: 'A robot that crosses a room and avoids at least three obstacles without your help.',
        },
      },
    ],
    references: [],
    suggestedTopics: [
      { title: 'Arduino official documentation', description: 'Getting-started guides, language reference and tutorials.', query: 'Arduino documentation getting started', url: 'https://docs.arduino.cc/' },
      { title: 'Arduino (Wikipedia)', description: 'History and hardware overview of the platform.', query: 'Arduino platform overview', url: 'https://en.wikipedia.org/wiki/Arduino' },
      { title: 'PID control for line-following robots', description: 'The natural next step after simple if-statements.', query: 'PID controller line following robot', url: '' },
      { title: 'Motor drivers: L298N versus TB6612', description: 'How to choose a driver for your next build.', query: 'L298N vs TB6612FNG motor driver', url: '' },
    ],
    meta: { sample: true },
  };

  S.mock = {
    /** A fresh, validated copy of the sample course. */
    course() {
      const c = S.schema.normalizeCourse(JSON.parse(JSON.stringify(raw)));
      c.meta.topic = 'Teach me robotics from the fundamentals to building my first Arduino-based robot.';
      c.meta.sample = true;
      return c;
    },
  };
})();
