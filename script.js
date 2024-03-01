const cells = document.querySelectorAll('.cell');
const status = document.querySelector('.status');
const restartButton = document.querySelector('.restart-button');

let xIsNext = true;
let gameIsLive = true;
let winner = null;

const winningCombos = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
];

restartButton.addEventListener('click', () => {
    startGame();
});

startGame();

function startGame() {
    xIsNext = true;
    gameIsLive = true;
    winner = null;
    status.textContent = 'Clique para começar';
    cells.forEach(cell => {
        cell.textContent = '';
        cell.classList.remove('winner');
    });
}

cells.forEach(cell => {
    cell.addEventListener('click', () => {
        const cellIndex = parseInt(cell.getAttribute('data-cell-index'));
        
        if (gameIsLive && !cell.textContent) {
            cell.textContent = xIsNext ? 'X' : 'O';
            
            if (checkWinner()) {
                status.textContent = `${winner} venceu!`;
                gameIsLive = false;
                highlightWinningCombo();
            } else if (isDraw()) {
                status.textContent = 'Empate!';
                gameIsLive = false;
            } else {
                xIsNext = !xIsNext;
                status.textContent = `${xIsNext ? 'X' : 'O'} é a sua vez`;
            }
        }
    });
});

function checkWinner() {
    for (let i = 0; i < winningCombos.length; i++) {
        const [a, b, c] = winningCombos[i];
        const cellA = cells[a].textContent;
        const cellB = cells[b].textContent;
        const cellC = cells[c].textContent;
        
        if (cellA && cellA === cellB && cellA === cellC) {
            winner = cellA;
            return true;
        }
    }
    return false;
}

function isDraw() {
    return [...cells].every(cell => cell.textContent);
}

function highlightWinningCombo() {
    for (let i = 0; i < winningCombos.length; i++) {
        const [a, b, c] = winningCombos[i];
        const cellA = cells[a];
        const cellB = cells[b];
        const cellC = cells[c];
        
        if (cellA.textContent && cellA.textContent === cellB.textContent && cellA.textContent === cellC.textContent) {
            cellA.classList.add('winner');
            cellB.classList.add('winner');
            cellC.classList.add('winner');
        }
    }
}

/* Siga @marcoshdesousa no instagran */
