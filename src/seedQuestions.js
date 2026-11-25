/**
 * Pre-built verified MCQ question bank for CodeAura Exam Portal.
 * Subjects: HTML, CSS, JavaScript, Python (30 MCQs each = 120 MCQs).
 */

const DEFAULT_SUBJECTS = [
  {
    id: 'html',
    name: 'HTML',
    fullName: 'HTML5 & Web Structure',
    color: '#ea580c',
    bgColor: '#fff7ed',
    badge: 'HTML5'
  },
  {
    id: 'css',
    name: 'CSS',
    fullName: 'CSS3 Styling & Layout',
    color: '#0284c7',
    bgColor: '#f0f9ff',
    badge: 'CSS3'
  },
  {
    id: 'js',
    name: 'JavaScript',
    fullName: 'JavaScript & DOM (ES6+)',
    color: '#ca8a04',
    bgColor: '#fefce8',
    badge: 'JS'
  },
  {
    id: 'python',
    name: 'Python',
    fullName: 'Python Programming',
    color: '#059669',
    bgColor: '#ecfdf5',
    badge: 'PY'
  }
];

const SEED_QUESTIONS = [
  // ===================== HTML (30) =====================
  {
    id: 'html-01',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'What does HTML stand for?',
    code: '',
    options: [
      'Hyper Text Markup Language',
      'High Tech Modern Language',
      'Hyperlinks and Text Management Language',
      'Home Tool Markup Language'
    ],
    correctIndex: 0,
    explanation: 'HTML stands for Hyper Text Markup Language, the standard markup language for creating web pages.'
  },
  {
    id: 'html-02',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which HTML element defines the largest heading?',
    code: '',
    options: ['<heading>', '<h6>', '<h1>', '<head>'],
    correctIndex: 2,
    explanation: '<h1> defines the most important (largest default) heading, while <h6> defines the smallest.'
  },
  {
    id: 'html-03',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which attribute specifies the destination URL of a link in an <a> tag?',
    code: '',
    options: ['src', 'href', 'link', 'url'],
    correctIndex: 1,
    explanation: 'The href (Hypertext Reference) attribute specifies the URL of the page the link goes to.'
  },
  {
    id: 'html-04',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which HTML tag is used to insert a line break without starting a new paragraph?',
    code: '',
    options: ['<lb>', '<break>', '<br>', '<hr>'],
    correctIndex: 2,
    explanation: '<br> inserts a single line break. <hr> inserts a thematic break (horizontal rule).'
  },
  {
    id: 'html-05',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which attribute is required on an <img> tag to provide alternative text for accessibility and broken images?',
    code: '',
    options: ['title', 'alt', 'caption', 'aria-src'],
    correctIndex: 1,
    explanation: 'The alt attribute provides alternative text if the image cannot be displayed and for screen readers.'
  },
  {
    id: 'html-06',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which tag creates a numbered (ordered) list in HTML?',
    code: '',
    options: ['<ul>', '<ol>', '<dl>', '<list>'],
    correctIndex: 1,
    explanation: '<ol> creates an ordered (numbered) list, while <ul> creates an unordered (bulleted) list.'
  },
  {
    id: 'html-07',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'What is the correct declaration at the very top of an HTML5 document?',
    code: '',
    options: ['<!HTML5>', '<!DOCTYPE html>', '<doctype html5>', '<meta html="5">'],
    correctIndex: 1,
    explanation: '<!DOCTYPE html> tells the browser to render the document in standards mode using HTML5.'
  },
  {
    id: 'html-08',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which HTML element is used to define a table row?',
    code: '',
    options: ['<td>', '<th>', '<tr>', '<row>'],
    correctIndex: 2,
    explanation: '<tr> defines a table row, <th> defines a header cell, and <td> defines a standard data cell.'
  },
  {
    id: 'html-09',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which input type hides the typed characters (e.g., as dots or asterisks)?',
    code: '',
    options: ['type="hidden"', 'type="secret"', 'type="password"', 'type="text-mask"'],
    correctIndex: 2,
    explanation: '<input type="password"> masks user input on screen. type="hidden" makes the entire field invisible.'
  },
  {
    id: 'html-10',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Where should the <title> element be placed in an HTML document?',
    code: '',
    options: ['Inside <body>', 'Inside <head>', 'Inside <header>', 'After </html>'],
    correctIndex: 1,
    explanation: 'The <title> element contains document metadata (browser tab title) and belongs inside <head>.'
  },
  {
    id: 'html-11',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which attribute opens an anchor link in a new browser tab or window?',
    code: '<a href="https://example.com" ???>Visit</a>',
    options: ['target="_new"', 'target="_blank"', 'window="new"', 'rel="tab"'],
    correctIndex: 1,
    explanation: 'target="_blank" instructs the browser to open the linked document in a new tab or window.'
  },
  {
    id: 'html-12',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which semantic HTML5 tag represents self-contained content such as a blog post or news story?',
    code: '',
    options: ['<div>', '<section>', '<article>', '<aside>'],
    correctIndex: 2,
    explanation: '<article> represents independent, self-contained content that could be syndicated or reused on its own.'
  },
  {
    id: 'html-13',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which attribute makes a form input field mandatory before submission?',
    code: '',
    options: ['validate', 'mandatory', 'required', 'mustfill'],
    correctIndex: 2,
    explanation: 'The boolean attribute required prevents form submission until the field has a valid value.'
  },
  {
    id: 'html-14',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'How do you associate a <label> with a specific <input> element using attributes?',
    code: '<label ???="email">Email</label>\n<input type="email" id="email">',
    options: ['name="email"', 'for="email"', 'bind="email"', 'target="email"'],
    correctIndex: 1,
    explanation: 'The label\'s for attribute must match the input\'s id attribute to link them for clicking and screen readers.'
  },
  {
    id: 'html-15',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which HTML element creates a dropdown selection list?',
    code: '',
    options: ['<dropdown>', '<list>', '<select>', '<datalist>'],
    correctIndex: 2,
    explanation: '<select> paired with <option> elements creates a dropdown menu.'
  },
  {
    id: 'html-16',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which attribute allows a table cell (<td>) to span across multiple columns?',
    code: '',
    options: ['rowspan', 'colspan', 'spancols', 'merge'],
    correctIndex: 1,
    explanation: 'colspan="N" makes a cell span across N columns, while rowspan="N" spans across N rows.'
  },
  {
    id: 'html-17',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'What is the purpose of the <meta name="viewport" content="width=device-width, initial-scale=1.0"> tag?',
    code: '',
    options: [
      'Sets the page background color',
      'Makes the page responsive to mobile screen widths',
      'Blocks search engines from indexing the page',
      'Preloads all images in the viewport'
    ],
    correctIndex: 1,
    explanation: 'The viewport meta tag tells mobile browsers to match the page width to the device\'s screen width at 1:1 zoom.'
  },
  {
    id: 'html-18',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which HTML tag embeds playable video content natively in HTML5?',
    code: '',
    options: ['<media>', '<movie>', '<video>', '<embed-video>'],
    correctIndex: 2,
    explanation: 'HTML5 introduced <video> and <audio> for native media playback without plugins.'
  },
  {
    id: 'html-19',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which HTTP method should a <form> use when sending sensitive data like passwords?',
    code: '',
    options: ['GET', 'POST', 'HEAD', 'FETCH'],
    correctIndex: 1,
    explanation: 'POST sends form data in the request body instead of appending it visibly to the URL like GET.'
  },
  {
    id: 'html-20',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'What is the difference between <div> and <span> by default?',
    code: '',
    options: [
      '<div> is inline, <span> is block-level',
      '<div> is block-level, <span> is inline',
      'Both are block-level elements',
      '<span> can only contain images'
    ],
    correctIndex: 1,
    explanation: '<div> is a block-level container (starts on a new line), whereas <span> is an inline container.'
  },
  {
    id: 'html-21',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'For radio buttons to work as a mutually exclusive group (only one selectable at a time), which attribute must share the same value?',
    code: '',
    options: ['id', 'class', 'name', 'value'],
    correctIndex: 2,
    explanation: 'All <input type="radio"> elements in the same group must have the identical name attribute.'
  },
  {
    id: 'html-22',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'Which HTML5 element groups a caption (<figcaption>) together with an image or diagram?',
    code: '',
    options: ['<picture>', '<figure>', '<canvas>', '<aside>'],
    correctIndex: 1,
    explanation: '<figure> wraps self-contained illustrations, diagrams, or photos along with an optional <figcaption>.'
  },
  {
    id: 'html-23',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'Which attribute on <script> downloads the script in parallel and executes it in document order AFTER HTML parsing finishes?',
    code: '',
    options: ['async', 'defer', 'lazy', 'module-wait'],
    correctIndex: 1,
    explanation: 'defer downloads scripts in parallel without blocking HTML parsing and executes them in order right before DOMContentLoaded.'
  },
  {
    id: 'html-24',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'How do you write an HTML comment?',
    code: '',
    options: ['// comment', '/* comment */', '<!-- comment -->', '# comment'],
    correctIndex: 2,
    explanation: 'HTML comments begin with <!-- and end with -->.'
  },
  {
    id: 'html-25',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'Which HTML entity renders a non-breaking space?',
    code: '',
    options: ['&space;', '&nbsp;', '&lt;', '&amp;'],
    correctIndex: 1,
    explanation: '&nbsp; stands for non-breaking space, preventing browsers from collapsing multiple spaces or breaking a line there.'
  },
  {
    id: 'html-26',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'Which attribute is used on custom HTML elements to store extra private data accessible via JavaScript element.dataset?',
    code: '<button ???="42">Buy</button>',
    options: ['meta-id', 'data-id', 'custom-id', 'var-id'],
    correctIndex: 1,
    explanation: 'Attributes prefixed with data-* are valid custom data attributes accessible in JS via element.dataset.'
  },
  {
    id: 'html-27',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'In a <form>, what does the action attribute specify?',
    code: '',
    options: [
      'The JavaScript event handler name',
      'The URL where the form data is sent on submission',
      'Whether the form uses GET or POST',
      'The validation pattern for inputs'
    ],
    correctIndex: 1,
    explanation: 'The action attribute specifies the server endpoint URL that receives the submitted form data.'
  },
  {
    id: 'html-28',
    subjectId: 'html',
    difficulty: 'Medium',
    question: 'Which HTML5 element is specifically intended to wrap major navigation links?',
    code: '',
    options: ['<menu>', '<nav>', '<links>', '<header-nav>'],
    correctIndex: 1,
    explanation: '<nav> is the semantic landmark element for major sections of navigation links.'
  },
  {
    id: 'html-29',
    subjectId: 'html',
    difficulty: 'Hard',
    question: 'What does loading="lazy" on an <img> tag do?',
    code: '<img src="photo.jpg" alt="Photo" loading="lazy">',
    options: [
      'Reduces image resolution automatically',
      'Defers loading off-screen images until the user scrolls near them',
      'Preloads the image before CSS',
      'Converts PNG to WebP'
    ],
    correctIndex: 1,
    explanation: 'loading="lazy" tells the browser to wait until an image approaches the viewport before downloading it.'
  },
  {
    id: 'html-30',
    subjectId: 'html',
    difficulty: 'Easy',
    question: 'Which HTML element creates a multi-line text input area?',
    code: '',
    options: ['<input type="multiline">', '<textbox>', '<textarea>', '<text>'],
    correctIndex: 2,
    explanation: '<textarea> defines a multi-line text input control.'
  },

  // ===================== CSS (30) =====================
  {
    id: 'css-01',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'What does CSS stand for?',
    code: '',
    options: [
      'Computer Style Sheets',
      'Cascading Style Sheets',
      'Creative Styling System',
      'Colorful Style Sheets'
    ],
    correctIndex: 1,
    explanation: 'CSS stands for Cascading Style Sheets, used to style and lay out web pages.'
  },
  {
    id: 'css-02',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which CSS property changes the text color of an element?',
    code: '',
    options: ['text-color', 'font-color', 'color', 'fgcolor'],
    correctIndex: 2,
    explanation: 'The color property sets the foreground text color of an element.'
  },
  {
    id: 'css-03',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'How do you select an element with id="header" in CSS?',
    code: '',
    options: ['.header', '#header', '*header', '@header'],
    correctIndex: 1,
    explanation: '# selects an element by id, whereas . selects elements by class.'
  },
  {
    id: 'css-04',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'How do you select all elements with class="card" in CSS?',
    code: '',
    options: ['#card', '.card', 'card', '*card'],
    correctIndex: 1,
    explanation: 'The dot (.) prefix targets elements matching that class name.'
  },
  {
    id: 'css-05',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which property controls the space INSIDE an element\'s border around its content?',
    code: '',
    options: ['margin', 'padding', 'spacing', 'gap'],
    correctIndex: 1,
    explanation: 'padding creates space inside the border; margin creates space outside the border.'
  },
  {
    id: 'css-06',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which property makes text bold in CSS?',
    code: '',
    options: ['font-style: bold', 'text-weight: bold', 'font-weight: bold', 'font-bold: true'],
    correctIndex: 2,
    explanation: 'font-weight (e.g., bold or 700) controls the thickness/boldness of text.'
  },
  {
    id: 'css-07',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which HTML tag links an external CSS stylesheet inside <head>?',
    code: '',
    options: [
      '<style src="style.css">',
      '<css href="style.css">',
      '<link rel="stylesheet" href="style.css">',
      '<script href="style.css">'
    ],
    correctIndex: 2,
    explanation: '<link rel="stylesheet" href="..."> links an external CSS file to an HTML document.'
  },
  {
    id: 'css-08',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'How do you write a comment in CSS?',
    code: '',
    options: ['// comment', '<!-- comment -->', '/* comment */', '# comment'],
    correctIndex: 2,
    explanation: 'CSS comments are enclosed between /* and */.'
  },
  {
    id: 'css-09',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which CSS property rounds the corners of an element\'s border?',
    code: '',
    options: ['corner-radius', 'border-round', 'border-radius', 'round-corner'],
    correctIndex: 2,
    explanation: 'border-radius rounds the outer corners of an element box.'
  },
  {
    id: 'css-10',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which property removes the underline from an <a> link?',
    code: '',
    options: ['text-underline: none', 'text-decoration: none', 'font-decoration: none', 'underline: false'],
    correctIndex: 1,
    explanation: 'text-decoration: none removes underlines (and overlines/line-throughs) from text.'
  },
  {
    id: 'css-11',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'In Flexbox, which property aligns flex items along the MAIN axis (horizontally by default)?',
    code: '.container {\n  display: flex;\n  ???: center;\n}',
    options: ['align-items', 'justify-content', 'place-self', 'flex-align'],
    correctIndex: 1,
    explanation: 'justify-content aligns items along the main axis; align-items aligns along the cross axis.'
  },
  {
    id: 'css-12',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'In Flexbox, what does flex-direction: column do?',
    code: '',
    options: [
      'Arranges items side by side horizontally',
      'Stacks items vertically from top to bottom',
      'Hides overflowing items',
      'Creates a multi-column grid'
    ],
    correctIndex: 1,
    explanation: 'flex-direction: column sets the main axis vertically from top to bottom.'
  },
  {
    id: 'css-13',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'What does box-sizing: border-box do?',
    code: '',
    options: [
      'Excludes padding and border from the specified width and height',
      'Includes padding and border inside the element\'s declared width and height',
      'Automatically adds a 1px border to every box',
      'Centers the box horizontally'
    ],
    correctIndex: 1,
    explanation: 'With border-box, declared width and height include content + padding + border, making layouts predictable.'
  },
  {
    id: 'css-14',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'What is the total rendered width of this box with default box-sizing (content-box)?',
    code: '.box {\n  width: 200px;\n  padding: 20px;\n  border: 5px solid black;\n}',
    options: ['200px', '225px', '240px', '250px'],
    correctIndex: 3,
    explanation: 'With content-box: 200 + (20*2 left/right padding) + (5*2 left/right border) = 250px.'
  },
  {
    id: 'css-15',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'Which CSS selector has the HIGHEST specificity?',
    code: '',
    options: ['div p', '.btn.primary', '#navbar', 'p::before'],
    correctIndex: 2,
    explanation: 'An ID selector (#navbar, specificity 1-0-0) beats classes (0-2-0) and element/pseudo-element selectors.'
  },
  {
    id: 'css-16',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'Which position value removes an element from normal document flow and positions it relative to the viewport (stays put on scroll)?',
    code: '',
    options: ['relative', 'absolute', 'fixed', 'static'],
    correctIndex: 2,
    explanation: 'position: fixed positions an element relative to the browser viewport, keeping it in place when scrolling.'
  },
  {
    id: 'css-17',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'What does margin: 10px 20px; set?',
    code: '',
    options: [
      '10px top/bottom, 20px left/right',
      '10px left/right, 20px top/bottom',
      '10px top, 20px bottom only',
      '10px all sides, 20px gap'
    ],
    correctIndex: 0,
    explanation: 'In 2-value shorthand, the first value applies to top & bottom, and the second applies to left & right.'
  },
  {
    id: 'css-18',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'Which CSS pseudo-class styles an element when the user moves the mouse pointer over it?',
    code: '',
    options: [':active', ':focus', ':hover', ':visited'],
    correctIndex: 2,
    explanation: ':hover matches when the user hovers over an element with a pointing device.'
  },
  {
    id: 'css-19',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'In CSS Grid, what does grid-template-columns: repeat(3, 1fr); create?',
    code: '',
    options: [
      '3 rows of 1px height',
      '3 equal-width flexible columns',
      '1 column repeated 3 times vertically',
      'A 3px grid gap'
    ],
    correctIndex: 1,
    explanation: 'repeat(3, 1fr) creates 3 columns, each taking 1 fraction (equal share) of the available grid space.'
  },
  {
    id: 'css-20',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'What is the difference between display: none and visibility: hidden?',
    code: '',
    options: [
      'Both remove the element from layout space',
      'display: none removes the space; visibility: hidden hides it while keeping its space',
      'visibility: hidden deletes the element from DOM',
      'There is no difference'
    ],
    correctIndex: 1,
    explanation: 'display: none collapses the element\'s layout space completely, whereas visibility: hidden leaves an empty box.'
  },
  {
    id: 'css-21',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'How do you define and use a CSS custom property (variable) globally?',
    code: '',
    options: [
      ':root { $main: blue; }  color: $main;',
      ':root { --main: blue; }  color: var(--main);',
      'body { @main: blue; }  color: @main;',
      ':global { main: blue; }  color: get(main);'
    ],
    correctIndex: 1,
    explanation: 'CSS variables are declared with --name (often in :root) and referenced with var(--name).'
  },
  {
    id: 'css-22',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'Which at-rule is used to apply different styles based on screen width (responsive design)?',
    code: '',
    options: ['@keyframes', '@import', '@media', '@supports'],
    correctIndex: 2,
    explanation: '@media queries apply styles conditionally based on viewport width, height, orientation, etc.'
  },
  {
    id: 'css-23',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'Which relative CSS unit is relative to the font-size of the ROOT (<html>) element?',
    code: '',
    options: ['em', 'rem', 'vw', '%'],
    correctIndex: 1,
    explanation: 'rem (root em) is relative to <html>\'s font-size, whereas em is relative to the current/parent element\'s font-size.'
  },
  {
    id: 'css-24',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'What does the CSS selector div > p match?',
    code: '',
    options: [
      'Every <p> anywhere inside a <div>',
      'Only <p> elements that are direct children of a <div>',
      'Every <p> immediately after a <div>',
      'Every <div> inside a <p>'
    ],
    correctIndex: 1,
    explanation: 'The child combinator (>) matches only direct children, unlike the descendant combinator (space).'
  },
  {
    id: 'css-25',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'Which property controls the stacking order of positioned elements along the Z-axis?',
    code: '',
    options: ['stack-order', 'layer-index', 'z-index', 'depth'],
    correctIndex: 2,
    explanation: 'z-index determines which positioned (or flex/grid) element appears on top when elements overlap.'
  },
  {
    id: 'css-26',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'In a position: absolute element, what is it positioned relative to?',
    code: '',
    options: [
      'Always the <body> element',
      'Its nearest ancestor with a position other than static (or the initial containing block)',
      'Always the viewport',
      'The next sibling element'
    ],
    correctIndex: 1,
    explanation: 'An absolutely positioned element anchors to its closest positioned ancestor (relative, absolute, fixed, or sticky).'
  },
  {
    id: 'css-27',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'Which CSS property smoothly animates property changes over a duration when a state like :hover changes?',
    code: '',
    options: ['animation-delay', 'transition', 'transform', 'ease-flow'],
    correctIndex: 1,
    explanation: 'transition defines smooth interpolation between property values over a specified duration.'
  },
  {
    id: 'css-28',
    subjectId: 'css',
    difficulty: 'Medium',
    question: 'Which Flexbox property allows flex items to wrap onto multiple lines instead of shrinking into one line?',
    code: '',
    options: ['flex-flow: nowrap', 'flex-wrap: wrap', 'flex-break: auto', 'white-space: wrap'],
    correctIndex: 1,
    explanation: 'flex-wrap: wrap enables flex items to move onto new lines when container width is exceeded.'
  },
  {
    id: 'css-29',
    subjectId: 'css',
    difficulty: 'Hard',
    question: 'Which pseudo-element lets you insert decorative content BEFORE the actual content of an element?',
    code: '',
    options: [':first-child', '::before', '::first-line', ':prepend'],
    correctIndex: 1,
    explanation: '::before creates a pseudo-element as the first child of the selected element, typically using the content property.'
  },
  {
    id: 'css-30',
    subjectId: 'css',
    difficulty: 'Easy',
    question: 'Which property sets the background color of an element?',
    code: '',
    options: ['bgcolor', 'color-bg', 'background-color', 'surface'],
    correctIndex: 2,
    explanation: 'background-color (or the shorthand background) defines an element\'s background fill color.'
  },

  // ===================== JAVASCRIPT (30) =====================
  {
    id: 'js-01',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'Which keyword declares a block-scoped variable that CANNOT be reassigned?',
    code: '',
    options: ['var', 'let', 'const', 'static'],
    correctIndex: 2,
    explanation: 'const creates a block-scoped binding that cannot be reassigned after initialization.'
  },
  {
    id: 'js-02',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'What is the output of typeof null in JavaScript?',
    code: 'console.log(typeof null);',
    options: ['"null"', '"undefined"', '"object"', '"boolean"'],
    correctIndex: 2,
    explanation: 'Due to a historic bug kept for backward compatibility, typeof null returns "object".'
  },
  {
    id: 'js-03',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'Which operator checks BOTH value and type equality (strict equality)?',
    code: '',
    options: ['==', '===', '!=', ':='],
    correctIndex: 1,
    explanation: '=== compares both value and type without implicit type coercion.'
  },
  {
    id: 'js-04',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'What does console.log(5 + "5") print in JavaScript?',
    code: 'console.log(5 + "5");',
    options: ['10', '"55"', 'NaN', 'Error'],
    correctIndex: 1,
    explanation: 'With +, if either operand is a string, JavaScript performs string concatenation, producing "55".'
  },
  {
    id: 'js-05',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'Which array method adds one or more elements to the END of an array?',
    code: '',
    options: ['pop()', 'shift()', 'push()', 'unshift()'],
    correctIndex: 2,
    explanation: 'push() appends to the end; pop() removes from the end; unshift() adds to the beginning.'
  },
  {
    id: 'js-06',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'How do you select the FIRST element matching a CSS selector in the DOM?',
    code: '',
    options: [
      'document.getElementsByClass()',
      'document.querySelector()',
      'document.querySelectorAll()',
      'document.select()'
    ],
    correctIndex: 1,
    explanation: 'document.querySelector() returns the first matching Element (or null if none matches).'
  },
  {
    id: 'js-07',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'Which method converts a JSON string into a JavaScript object?',
    code: '',
    options: ['JSON.stringify()', 'JSON.parse()', 'JSON.toObject()', 'JSON.decode()'],
    correctIndex: 1,
    explanation: 'JSON.parse() parses a JSON string into a JS value/object; JSON.stringify() converts an object to JSON.'
  },
  {
    id: 'js-08',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'What is the value of an uninitialized variable declared with let x;?',
    code: 'let x;\nconsole.log(x);',
    options: ['null', '0', 'undefined', 'ReferenceError'],
    correctIndex: 2,
    explanation: 'A declared variable without an assigned value automatically holds undefined.'
  },
  {
    id: 'js-09',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'How do you attach a click event handler to a button element in modern JS?',
    code: '',
    options: [
      'btn.onClick("click", fn)',
      'btn.addEventListener("click", fn)',
      'btn.attachEvent("click", fn)',
      'btn.listen("click", fn)'
    ],
    correctIndex: 1,
    explanation: 'element.addEventListener("click", callback) is the standard DOM API for attaching event listeners.'
  },
  {
    id: 'js-10',
    subjectId: 'js',
    difficulty: 'Easy',
    question: 'Which syntax represents an ES6 arrow function returning a + b?',
    code: '',
    options: [
      'function(a, b) => a + b',
      '(a, b) -> a + b',
      '(a, b) => a + b',
      'def (a, b) => a + b'
    ],
    correctIndex: 2,
    explanation: '(a, b) => a + b uses arrow function syntax with an implicit return.'
  },
  {
    id: 'js-11',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What is the output of the following code?',
    code: 'const nums = [1, 2, 3, 4];\nconst doubled = nums.map(n => n * 2);\nconsole.log(doubled);',
    options: ['[1, 2, 3, 4]', '[2, 4, 6, 8]', '[2, 4]', '10'],
    correctIndex: 1,
    explanation: 'Array.prototype.map() creates a new array populated with the results of calling the callback on every element.'
  },
  {
    id: 'js-12',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'Which array method creates a NEW array containing only elements that pass a test function?',
    code: '',
    options: ['map()', 'forEach()', 'filter()', 'reduce()'],
    correctIndex: 2,
    explanation: 'filter() returns a shallow copy array containing only elements for which the callback returns truthy.'
  },
  {
    id: 'js-13',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What does the following code print?',
    code: 'console.log(Boolean("false"));\nconsole.log(Boolean(""));',
    options: ['false, false', 'true, false', 'false, true', 'true, true'],
    correctIndex: 1,
    explanation: 'Any non-empty string (including "false") is truthy; an empty string "" is falsy.'
  },
  {
    id: 'js-14',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What is the output of [1, 2, 3].reduce((acc, cur) => acc + cur, 10)?',
    code: 'const result = [1, 2, 3].reduce((acc, cur) => acc + cur, 10);\nconsole.log(result);',
    options: ['6', '16', '13', '10'],
    correctIndex: 1,
    explanation: 'The initial accumulator value is 10, so 10 + 1 + 2 + 3 = 16.'
  },
  {
    id: 'js-15',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'Which statement correctly uses template literals for string interpolation?',
    code: 'const name = "Ayan";',
    options: [
      '"Hello ${name}"',
      '\'Hello #{name}\'',
      '`Hello ${name}`',
      '`Hello {name}`'
    ],
    correctIndex: 2,
    explanation: 'Template literals use backticks (`) and ${expression} placeholders.'
  },
  {
    id: 'js-16',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What does the spread operator (...) do in const copy = [...arr];?',
    code: 'const arr = [1, 2, 3];\nconst copy = [...arr];',
    options: [
      'Creates a reference to the exact same array',
      'Creates a shallow copy of arr into a new array',
      'Reverses the array elements',
      'Converts the array to a string'
    ],
    correctIndex: 1,
    explanation: '[...arr] expands arr elements into a brand-new array (shallow copy).'
  },
  {
    id: 'js-17',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What is the output of this object destructuring snippet?',
    code: 'const user = { name: "Riya", role: "Student" };\nconst { name } = user;\nconsole.log(name);',
    options: ['undefined', '{ name: "Riya" }', '"Riya"', 'SyntaxError'],
    correctIndex: 2,
    explanation: 'Object destructuring extracts user.name into a local constant named name ("Riya").'
  },
  {
    id: 'js-18',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What does fetch() return in browser JavaScript?',
    code: '',
    options: [
      'A synchronous JSON object',
      'A Promise that resolves to a Response object',
      'An XML string',
      'A callback function'
    ],
    correctIndex: 1,
    explanation: 'fetch() is asynchronous and returns a Promise resolving to the HTTP Response.'
  },
  {
    id: 'js-19',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'Inside an async function, what does the await keyword do?',
    code: '',
    options: [
      'Blocks the entire browser UI thread',
      'Pauses the async function until the Promise settles and returns its resolved value',
      'Converts a synchronous loop into parallel threads',
      'Cancels a Promise'
    ],
    correctIndex: 1,
    explanation: 'await pauses execution inside that async function until the Promise resolves or rejects.'
  },
  {
    id: 'js-20',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'How does setTimeout(fn, 0) behave relative to synchronous console.log statements?',
    code: 'console.log("A");\nsetTimeout(() => console.log("B"), 0);\nconsole.log("C");',
    options: ['A, B, C', 'A, C, B', 'B, A, C', 'C, B, A'],
    correctIndex: 1,
    explanation: 'setTimeout callbacks enter the task queue and run only after the current synchronous call stack clears (A, C, then B).'
  },
  {
    id: 'js-21',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What will be logged by this closure example?',
    code: 'function makeCounter() {\n  let count = 0;\n  return () => ++count;\n}\nconst inc = makeCounter();\nconsole.log(inc(), inc());',
    options: ['0 1', '1 1', '1 2', 'undefined undefined'],
    correctIndex: 2,
    explanation: 'The returned arrow function forms a closure over count, preserving and incrementing it across calls: 1, then 2.'
  },
  {
    id: 'js-22',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What is the output of this var vs let loop with setTimeout?',
    code: 'for (let i = 0; i < 3; i++) {\n  setTimeout(() => console.log(i), 10);\n}',
    options: ['3 3 3', '0 1 2', '1 2 3', '0 0 0'],
    correctIndex: 1,
    explanation: 'Because let is block-scoped, each iteration gets a fresh binding i, logging 0, 1, 2 (unlike var which logs 3, 3, 3).'
  },
  {
    id: 'js-23',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'Which expression safely accesses user.profile.email without throwing a TypeError if profile is undefined?',
    code: 'const user = {};',
    options: [
      'user.profile.email',
      'user.profile?.email',
      'user.profile!.email',
      'user.profile ?? email'
    ],
    correctIndex: 1,
    explanation: 'Optional chaining (?.) short-circuits and returns undefined if the left side is null or undefined.'
  },
  {
    id: 'js-24',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What does the nullish coalescing operator (??) return in: 0 ?? 42?',
    code: 'console.log(0 ?? 42);',
    options: ['42', '0', 'null', 'false'],
    correctIndex: 1,
    explanation: '?? only falls back to the right side when the left side is null or undefined. Since 0 is neither, it returns 0.'
  },
  {
    id: 'js-25',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'Which statement about Promise.all([p1, p2, p3]) is true?',
    code: '',
    options: [
      'It resolves when the first promise settles',
      'It resolves when ALL promises fulfill, or rejects immediately if any one rejects',
      'It always waits for all promises even if one rejects',
      'It executes promises one by one sequentially'
    ],
    correctIndex: 1,
    explanation: 'Promise.all fulfills with an array of results once all fulfill, or fast-rejects on the first rejection.'
  },
  {
    id: 'js-26',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What is printed by this Promise & microtask order snippet?',
    code: 'console.log(1);\nPromise.resolve().then(() => console.log(2));\nconsole.log(3);',
    options: ['1, 2, 3', '1, 3, 2', '2, 1, 3', '3, 1, 2'],
    correctIndex: 1,
    explanation: 'Synchronous logs (1, 3) run first, then the microtask queue runs Promise .then() (2).'
  },
  {
    id: 'js-27',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What does event.preventDefault() do inside a form submit listener?',
    code: '',
    options: [
      'Stops event bubbling to parent elements',
      'Prevents the browser\'s default action (such as page reload on form submit)',
      'Deletes all form inputs',
      'Removes the event listener'
    ],
    correctIndex: 1,
    explanation: 'preventDefault() cancels the browser\'s default behavior; stopPropagation() stops bubbling.'
  },
  {
    id: 'js-28',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'How do you store a string value under key "theme" in browser localStorage?',
    code: '',
    options: [
      'localStorage.save("theme", "dark")',
      'localStorage.setItem("theme", "dark")',
      'localStorage.put("theme", "dark")',
      'localStorage.add("theme", "dark")'
    ],
    correctIndex: 1,
    explanation: 'localStorage.setItem(key, value) stores string key-value pairs persistently in the browser.'
  },
  {
    id: 'js-29',
    subjectId: 'js',
    difficulty: 'Medium',
    question: 'What is the output of [10, 20, 30].includes(20)?',
    code: '',
    options: ['1', 'true', '20', 'undefined'],
    correctIndex: 1,
    explanation: 'Array.prototype.includes() returns a boolean (true or false) indicating whether the value exists.'
  },
  {
    id: 'js-30',
    subjectId: 'js',
    difficulty: 'Hard',
    question: 'What happens when you try to mutate an object property declared with const?',
    code: 'const user = { age: 20 };\nuser.age = 21;\nconsole.log(user.age);',
    options: [
      'Throws TypeError because user is const',
      'Prints 21',
      'Prints 20 (silently ignored)',
      'Prints undefined'
    ],
    correctIndex: 1,
    explanation: 'const prevents reassigning the variable binding (user = ...), not mutating properties inside the object.'
  },

  // ===================== PYTHON (30) =====================
  {
    id: 'py-01',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'Which keyword is used to define a function in Python?',
    code: '',
    options: ['func', 'function', 'def', 'lambda-def'],
    correctIndex: 2,
    explanation: 'Python functions are defined using the def keyword followed by the function name and parentheses.'
  },
  {
    id: 'py-02',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'What is the output of print(type([1, 2, 3]))?',
    code: 'print(type([1, 2, 3]))',
    options: ["<class 'tuple'>", "<class 'list'>", "<class 'array'>", "<class 'set'>"],
    correctIndex: 1,
    explanation: 'Square brackets [] create a Python list object.'
  },
  {
    id: 'py-03',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'Which symbol starts a single-line comment in Python?',
    code: '',
    options: ['//', '/*', '#', '--'],
    correctIndex: 2,
    explanation: 'In Python, # starts a comment that extends to the end of the line.'
  },
  {
    id: 'py-04',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'What does print(10 // 3) output in Python 3?',
    code: 'print(10 // 3)',
    options: ['3.333', '3', '1', '3.0'],
    correctIndex: 1,
    explanation: '// is the floor division operator, returning the integer quotient 3.'
  },
  {
    id: 'py-05',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'What does print(2 ** 4) output in Python?',
    code: 'print(2 ** 4)',
    options: ['8', '6', '16', '24'],
    correctIndex: 2,
    explanation: '** is the exponentiation operator: 2 to the power of 4 equals 16.'
  },
  {
    id: 'py-06',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'How do you find the number of items in a list named items?',
    code: '',
    options: ['items.length', 'size(items)', 'len(items)', 'count(items)'],
    correctIndex: 2,
    explanation: 'The built-in len() function returns the length (number of items) of a sequence or collection.'
  },
  {
    id: 'py-07',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'Which collection type in Python is ordered, immutable (cannot be changed after creation), and written with parentheses ()?',
    code: '',
    options: ['List', 'Dictionary', 'Tuple', 'Set'],
    correctIndex: 2,
    explanation: 'A tuple is an ordered, immutable sequence typically written with parentheses like (1, 2, 3).'
  },
  {
    id: 'py-08',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'What does print("Hi" * 3) output?',
    code: 'print("Hi" * 3)',
    options: ['Hi3', 'HiHiHi', 'Error', 'Hi Hi Hi'],
    correctIndex: 1,
    explanation: 'Multiplying a string by an integer repeats the string that many times: "HiHiHi".'
  },
  {
    id: 'py-09',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'Which method adds a single element to the end of a Python list?',
    code: '',
    options: ['add()', 'push()', 'append()', 'insert_end()'],
    correctIndex: 2,
    explanation: 'list.append(item) adds a single item to the end of the list in place.'
  },
  {
    id: 'py-10',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'How does Python define code blocks (like inside if, for, or def)?',
    code: '',
    options: [
      'Curly braces { }',
      'Indentation (leading whitespace)',
      'begin and end keywords',
      'Semicolons ;'
    ],
    correctIndex: 1,
    explanation: 'Python uses consistent indentation (typically 4 spaces) to delimit code blocks.'
  },
  {
    id: 'py-11',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What is the output of this list slicing expression?',
    code: 'nums = [10, 20, 30, 40, 50]\nprint(nums[1:4])',
    options: ['[10, 20, 30, 40]', '[20, 30, 40]', '[20, 30, 40, 50]', '[30, 40]'],
    correctIndex: 1,
    explanation: 'Slicing [start:stop] includes index start (1 -> 20) up to stop-1 (3 -> 40), giving [20, 30, 40].'
  },
  {
    id: 'py-12',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What does nums[-1] return for nums = [10, 20, 30, 40]?',
    code: 'nums = [10, 20, 30, 40]\nprint(nums[-1])',
    options: ['10', '40', 'IndexError', '-10'],
    correctIndex: 1,
    explanation: 'Negative indexing counts from the end of the sequence, so -1 refers to the last element (40).'
  },
  {
    id: 'py-13',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What is the output of this Python dictionary lookup?',
    code: 'student = {"name": "Dev", "marks": 95}\nprint(student.get("grade", "N/A"))',
    options: ['KeyError', 'None', 'N/A', 'grade'],
    correctIndex: 2,
    explanation: 'dict.get(key, default) returns the default value ("N/A") instead of raising KeyError when the key is missing.'
  },
  {
    id: 'py-14',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'Which numbers does range(2, 8, 2) generate?',
    code: 'print(list(range(2, 8, 2)))',
    options: ['[2, 4, 6, 8]', '[2, 4, 6]', '[2, 3, 4, 5, 6, 7]', '[4, 6, 8]'],
    correctIndex: 1,
    explanation: 'range(start=2, stop=8, step=2) stops before 8, producing 2, 4, 6.'
  },
  {
    id: 'py-15',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What does a Python set automatically guarantee?',
    code: 's = {1, 2, 2, 3, 3, 3}\nprint(len(s))',
    options: ['6', '3', '2', 'TypeError'],
    correctIndex: 1,
    explanation: 'Sets store only unique elements, so duplicates are removed and len(s) is 3.'
  },
  {
    id: 'py-16',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What is the output of this list comprehension?',
    code: 'res = [x * x for x in range(4) if x % 2 == 1]\nprint(res)',
    options: ['[0, 1, 4, 9]', '[1, 9]', '[1, 3]', '[0, 4]'],
    correctIndex: 1,
    explanation: 'For x in 0,1,2,3, odd values are 1 and 3. Squaring them yields [1, 9].'
  },
  {
    id: 'py-17',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'Which statement handles potential runtime errors in Python?',
    code: '',
    options: ['try / catch', 'try / except', 'attempt / rescue', 'check / error'],
    correctIndex: 1,
    explanation: 'Python uses try: ... except Exception: ... blocks to catch and handle exceptions.'
  },
  {
    id: 'py-18',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What does this f-string print?',
    code: 'score = 88\nprint(f"Marks: {score + 2}")',
    options: ['Marks: {score + 2}', 'Marks: 88 + 2', 'Marks: 90', 'SyntaxError'],
    correctIndex: 2,
    explanation: 'f-strings evaluate expressions inside {} at runtime, outputting "Marks: 90".'
  },
  {
    id: 'py-19',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'What is the output of "hello world".split()?',
    code: 'print("hello world".split())',
    options: [
      '["h", "e", "l", "l", "o"]',
      '["hello", "world"]',
      '("hello", "world")',
      '"helloworld"'
    ],
    correctIndex: 1,
    explanation: 'split() with no arguments splits a string by whitespace into a list of words.'
  },
  {
    id: 'py-20',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'In a Python class, what is the name of the constructor/initializer method?',
    code: '',
    options: ['__construct__', '__init__', 'constructor', '__new_obj__'],
    correctIndex: 1,
    explanation: '__init__(self, ...) initializes newly created instances of a class.'
  },
  {
    id: 'py-21',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What is the output of this classic mutable default argument trap?',
    code: 'def add_item(val, lst=[]):\n    lst.append(val)\n    return lst\n\nprint(add_item(1), add_item(2))',
    options: ['[1] [2]', '[1, 2] [1, 2]', '[1] [1, 2]', 'Error'],
    correctIndex: 1,
    explanation: 'Default mutable lists are created once at function definition time; both calls return the same mutated list ([1, 2]) at print time.'
  },
  {
    id: 'py-22',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What does *args in a Python function definition allow?',
    code: 'def total(*args):\n    return sum(args)',
    options: [
      'Passing a variable number of keyword arguments as a dict',
      'Passing a variable number of positional arguments as a tuple',
      'Unpacking only list arguments',
      'Multiplying arguments automatically'
    ],
    correctIndex: 1,
    explanation: '*args collects extra positional arguments into a tuple; **kwargs collects keyword arguments into a dict.'
  },
  {
    id: 'py-23',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What is the output of slicing with step -1: "python"[::-1]?',
    code: 'print("python"[::-1])',
    options: ['"python"', '"nohtyp"', '"n"', 'IndexError'],
    correctIndex: 1,
    explanation: '[::-1] slices from end to start with a step of -1, reversing the string to "nohtyp".'
  },
  {
    id: 'py-24',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What is the difference between a == b and a is b in Python?',
    code: '',
    options: [
      'They are completely identical',
      '== compares values; is compares object identity (memory address)',
      'is compares values; == compares object types',
      'is works only on integers'
    ],
    correctIndex: 1,
    explanation: '== checks value equality (__eq__), while is checks whether two references point to the exact same object in memory.'
  },
  {
    id: 'py-25',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'Why is using with open("data.txt", "r") as f: recommended when reading files?',
    code: '',
    options: [
      'It automatically creates the file if missing in read mode',
      'It guarantees the file is closed automatically when the block exits, even on errors',
      'It encrypts the file contents',
      'It reads the file twice as fast'
    ],
    correctIndex: 1,
    explanation: 'The with statement uses a context manager that reliably closes the file resource upon exiting the block.'
  },
  {
    id: 'py-26',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What does the lambda expression lambda x: x + 5 create?',
    code: 'fn = lambda x: x + 5\nprint(fn(10))',
    options: [
      'A class named lambda',
      'An anonymous single-expression function returning 15',
      'A generator object',
      'SyntaxError'
    ],
    correctIndex: 1,
    explanation: 'lambda creates a small anonymous inline function; fn(10) evaluates 10 + 5 = 15.'
  },
  {
    id: 'py-27',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What is the output of this list aliasing snippet?',
    code: 'a = [1, 2, 3]\nb = a\nb.append(4)\nprint(a)',
    options: ['[1, 2, 3]', '[1, 2, 3, 4]', '[4]', 'Error'],
    correctIndex: 1,
    explanation: 'b = a assigns a reference to the same list object, so mutating b also mutates a.'
  },
  {
    id: 'py-28',
    subjectId: 'python',
    difficulty: 'Medium',
    question: 'Which built-in function loops over a list while providing both the index and the value?',
    code: '',
    options: ['zip()', 'enumerate()', 'items()', 'index()'],
    correctIndex: 1,
    explanation: 'enumerate(iterable) yields (index, value) pairs cleanly during iteration.'
  },
  {
    id: 'py-29',
    subjectId: 'python',
    difficulty: 'Hard',
    question: 'What does a generator function use instead of return to produce items lazily one at a time?',
    code: '',
    options: ['emit', 'yield', 'next', 'lazy'],
    correctIndex: 1,
    explanation: 'yield pauses the function, returns a value, and resumes state on the next iteration.'
  },
  {
    id: 'py-30',
    subjectId: 'python',
    difficulty: 'Easy',
    question: 'What does input() ALWAYS return in Python 3?',
    code: '',
    options: ['int', 'str', 'bool', 'Depends on what the user typed'],
    correctIndex: 1,
    explanation: 'input() always returns a string (str); you must convert it with int() or float() for math.'
  }
];

module.exports = {
  DEFAULT_SUBJECTS,
  SEED_QUESTIONS
};
