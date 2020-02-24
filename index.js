var fs = require("fs");

function onLoadImage() {
    imgPath = document.getElementById("imgPath").value;
    console.log("Loading image:", imgPath);
};

// checks if image has Msdos/MBR or GPT partition scheme or invalid
function checkPartitionSystem(imgPath) {

}

// analyze master boot record (sector 0 of image)
function analyzeMbr(imgPath) {

};

// analyze gpt scheme
function analyzeGpt(imgPath) {
    
}

class DataSection {
    constructor(sector, offset, size, name, value, desc) {
        this.sector = sector;
        this.offset = offset;
        this.size = size;
        this.name = name;
        this.value = value;
        this.desc = desc;
    }
}