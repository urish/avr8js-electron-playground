class Examples {

  path() {
    return './examples/';
  }

  get(name) {
    let dir = name;
    readTextFile(this.path() + dir + '/' + name + '.ino');
  }
}

let examples = new Examples;

document.addEventListener('DOMContentLoaded', (event) => {

  const arrayExamples = [
    'blinks',
    'rgb',
    'fire',
    'rain',
    'cylon',
    'metaballs',
    'pacifica',
    'xymatrix',
    'ssd1306',
    'ssdcounter',
  ];

  arrayExamples.forEach(function (item) {
    let fn = "examples.get('" + item + "')";

    document.getElementById("editor-tab").innerHTML +=
      '<button class="btn-white" onclick="' + fn + '">' + item + "</button>\n";
  });

  // Load blink example
  examples.get('blinks');
});
